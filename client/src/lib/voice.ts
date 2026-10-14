import { VOICE, type VoiceSignal } from '@watch-party/shared';
import { iceServers } from './ice';
import type { AppSocket } from './socket';

export interface VoiceState {
  joined: boolean;
  muted: boolean;
  /** Member ids currently talking (including you). */
  speaking: string[];
}

interface Peer {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  analyser: AnalyserNode | null;
  pendingIce: RTCIceCandidateInit[];
}

/**
 * Voice channel as a WebRTC mesh: every participant holds one audio-only
 * connection to every other participant. Fine for a watch party (VOICE.maxParticipants);
 * the server only relays signalling. To avoid both sides offering at once,
 * the member with the smaller id always makes the offer.
 */
export class VoiceChat {
  private local: MediaStream | null = null;
  private peers = new Map<string, Peer>();
  private audioCtx: AudioContext | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private meter: ReturnType<typeof setInterval> | null = null;
  private state: VoiceState = { joined: false, muted: false, speaking: [] };

  constructor(
    private readonly socket: AppSocket,
    private readonly myId: () => string | null,
    private readonly onChange: (s: VoiceState) => void,
  ) {}

  async join(): Promise<void> {
    if (this.state.joined) return;
    this.local = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    this.audioCtx = new AudioContext();
    this.localAnalyser = this.analyse(this.local);
    this.meter = setInterval(() => this.measure(), 150);
    this.set({ joined: true, muted: false });
  }

  leave(): void {
    for (const id of [...this.peers.keys()]) this.drop(id);
    this.local?.getTracks().forEach((t) => t.stop());
    this.local = null;
    if (this.meter) clearInterval(this.meter);
    this.meter = null;
    void this.audioCtx?.close();
    this.audioCtx = null;
    this.set({ joined: false, muted: false, speaking: [] });
  }

  setMuted(muted: boolean): void {
    this.local?.getAudioTracks().forEach((t) => (t.enabled = !muted));
    this.set({ muted });
  }

  /** Bring connections in line with who is in the channel (from room state). */
  reconcile(voiceIds: string[]): void {
    const me = this.myId();
    if (!this.state.joined || !me) return;
    for (const id of this.peers.keys()) if (!voiceIds.includes(id)) this.drop(id);
    for (const id of voiceIds) {
      if (id !== me && !this.peers.has(id) && me < id) void this.offer(id);
    }
  }

  async handleSignal(from: string, signal: VoiceSignal): Promise<void> {
    if (!this.state.joined) return;
    if (signal.type === 'offer') {
      const peer = this.peers.get(from) ?? this.connect(from);
      await peer.pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
      await this.flushIce(peer);
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      this.send(from, { type: 'answer', sdp: answer.sdp ?? '' });
    } else if (signal.type === 'answer') {
      const peer = this.peers.get(from);
      if (!peer) return;
      await peer.pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
      await this.flushIce(peer);
    } else if (signal.type === 'ice') {
      const peer = this.peers.get(from);
      if (!peer) return;
      if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(signal.candidate).catch(() => {});
      else peer.pendingIce.push(signal.candidate);
    }
  }

  private async offer(id: string): Promise<void> {
    const peer = this.connect(id);
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    this.send(id, { type: 'offer', sdp: offer.sdp ?? '' });
  }

  private connect(id: string): Peer {
    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    const audio = new Audio();
    audio.autoplay = true;
    const peer: Peer = { pc, audio, analyser: null, pendingIce: [] };
    this.local?.getTracks().forEach((t) => pc.addTrack(t, this.local!));
    pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      const { candidate, sdpMid, sdpMLineIndex } = e.candidate;
      this.send(id, { type: 'ice', candidate: { candidate, sdpMid, sdpMLineIndex } });
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      audio.srcObject = stream;
      void audio.play().catch(() => {});
      peer.analyser = this.analyse(stream);
    };
    pc.onconnectionstatechange = () => {
      // A failed link is retried by whoever offers when room state next arrives.
      if (pc.connectionState === 'failed') this.drop(id);
    };
    this.peers.set(id, peer);
    return peer;
  }

  private async flushIce(peer: Peer): Promise<void> {
    for (const c of peer.pendingIce.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {});
  }

  private drop(id: string): void {
    const peer = this.peers.get(id);
    if (!peer) return;
    peer.pc.close();
    peer.audio.srcObject = null;
    this.peers.delete(id);
  }

  private send(to: string, signal: VoiceSignal): void {
    this.socket.emit('voice:signal', { to, signal });
  }

  private analyse(stream: MediaStream): AnalyserNode | null {
    if (!this.audioCtx) return null;
    const analyser = this.audioCtx.createAnalyser();
    analyser.fftSize = 512;
    this.audioCtx.createMediaStreamSource(stream).connect(analyser);
    return analyser;
  }

  /** Cheap RMS level check for the "speaking" ring, a few times a second. */
  private measure(): void {
    const level = (a: AnalyserNode | null) => {
      if (!a) return 0;
      const buf = new Float32Array(a.fftSize);
      a.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      return Math.sqrt(sum / buf.length);
    };
    const speaking: string[] = [];
    const me = this.myId();
    if (me && !this.state.muted && level(this.localAnalyser) > VOICE.speakingThreshold) speaking.push(me);
    for (const [id, p] of this.peers) if (level(p.analyser) > VOICE.speakingThreshold) speaking.push(id);
    if (speaking.join() !== this.state.speaking.join()) this.set({ speaking });
  }

  private set(patch: Partial<VoiceState>): void {
    this.state = { ...this.state, ...patch };
    this.onChange(this.state);
  }
}
