import { SCREEN_SHARE, type ScreenSignal } from '@watch-party/shared';
import { iceServers } from './ice';
import type { AppSocket } from './socket';

export interface ScreenState {
  /** What to show: your own capture while sharing, or the sharer's stream. */
  stream: MediaStream | null;
  sharing: boolean;
}

/**
 * Screen sharing over WebRTC, one-to-many: the sharer holds one outgoing
 * connection per viewer. Viewers ask for the stream with a `want` signal
 * whenever they see a share they aren't receiving (on start, late join or
 * after a reconnect), and the sharer answers each `want` with a fresh offer.
 * That single path covers every join order without extra state.
 */
export class ScreenShareClient {
  private local: MediaStream | null = null;
  /** Sharer side: viewerId -> connection. */
  private outgoing = new Map<string, RTCPeerConnection>();
  /** Viewer side: the connection from the current sharer. */
  private incoming: { from: string; pc: RTCPeerConnection; pendingIce: RTCIceCandidateInit[] } | null = null;
  private state: ScreenState = { stream: null, sharing: false };

  constructor(
    private readonly socket: AppSocket,
    private readonly onChange: (s: ScreenState) => void,
    /** Called when the browser's own "Stop sharing" button ends the capture. */
    private readonly onEnded: () => void,
  ) {}

  static supported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;
  }

  /** Ask the browser for a screen, window or tab. Throws if the user cancels. */
  async capture(): Promise<void> {
    this.local = await navigator.mediaDevices.getDisplayMedia({
      video: { height: { ideal: SCREEN_SHARE.maxHeight }, frameRate: { ideal: SCREEN_SHARE.frameRate } },
      audio: SCREEN_SHARE.audio,
    });
    this.local.getVideoTracks()[0]?.addEventListener('ended', () => this.onEnded());
    this.set({ stream: this.local, sharing: true });
  }

  /** Stop capturing and drop every outgoing connection. */
  stopSharing(): void {
    for (const pc of this.outgoing.values()) pc.close();
    this.outgoing.clear();
    this.local?.getTracks().forEach((t) => t.stop());
    this.local = null;
    if (this.state.sharing) this.set({ stream: null, sharing: false });
  }

  /**
   * React to room state: who is sharing now. Viewers request the stream from
   * a new sharer and drop it when the share ends.
   */
  sync(sharerId: string | null, myId: string | null): void {
    if (sharerId !== myId && this.local) this.stopSharing();
    if (!sharerId || sharerId === myId) {
      this.closeIncoming();
      return;
    }
    if (this.incoming?.from !== sharerId) {
      this.closeIncoming();
      this.socket.emit('screen:signal', { to: sharerId, signal: { type: 'want' } });
    }
  }

  async handleSignal(from: string, signal: ScreenSignal): Promise<void> {
    if (signal.type === 'want') return this.offerTo(from);
    if (signal.type === 'answer') {
      const pc = this.outgoing.get(from);
      if (pc) await pc.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
      return;
    }
    if (signal.type === 'offer') {
      this.closeIncoming();
      const pc = new RTCPeerConnection({ iceServers: iceServers() });
      const incoming = { from, pc, pendingIce: [] as RTCIceCandidateInit[] };
      this.incoming = incoming;
      pc.onicecandidate = (e) => e.candidate && this.sendIce(from, e.candidate);
      pc.ontrack = (e) => this.set({ stream: e.streams[0] ?? new MediaStream([e.track]) });
      pc.onconnectionstatechange = () => {
        // Lost the link: ask again (the sharer replaces its side on every `want`).
        if (pc.connectionState === 'failed' && this.incoming === incoming) {
          this.closeIncoming();
          this.socket.emit('screen:signal', { to: from, signal: { type: 'want' } });
        }
      };
      await pc.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
      for (const c of incoming.pendingIce.splice(0)) await pc.addIceCandidate(c).catch(() => {});
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.socket.emit('screen:signal', { to: from, signal: { type: 'answer', sdp: answer.sdp ?? '' } });
      return;
    }
    if (signal.type !== 'ice') return;
    // ICE: from a viewer (sharer side) or from the sharer (viewer side).
    const out = this.outgoing.get(from);
    if (out) {
      await out.addIceCandidate(signal.candidate).catch(() => {});
    } else if (this.incoming?.from === from) {
      if (this.incoming.pc.remoteDescription) await this.incoming.pc.addIceCandidate(signal.candidate).catch(() => {});
      else this.incoming.pendingIce.push(signal.candidate);
    }
  }

  private async offerTo(viewerId: string): Promise<void> {
    if (!this.local) return;
    this.outgoing.get(viewerId)?.close();
    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    this.outgoing.set(viewerId, pc);
    pc.onicecandidate = (e) => e.candidate && this.sendIce(viewerId, e.candidate);
    pc.onconnectionstatechange = () => {
      if ((pc.connectionState === 'failed' || pc.connectionState === 'closed') && this.outgoing.get(viewerId) === pc) {
        this.outgoing.delete(viewerId);
      }
    };
    for (const track of this.local.getTracks()) {
      const sender = pc.addTrack(track, this.local);
      if (track.kind === 'video') {
        const params = sender.getParameters();
        params.encodings = [{ ...(params.encodings?.[0] ?? {}), maxBitrate: SCREEN_SHARE.maxBitrate }];
        void sender.setParameters(params).catch(() => {});
      }
    }
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.socket.emit('screen:signal', { to: viewerId, signal: { type: 'offer', sdp: offer.sdp ?? '' } });
  }

  private sendIce(to: string, c: RTCIceCandidate): void {
    this.socket.emit('screen:signal', { to, signal: { type: 'ice', candidate: { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex } } });
  }

  private closeIncoming(): void {
    if (!this.incoming) return;
    this.incoming.pc.close();
    this.incoming = null;
    if (!this.state.sharing) this.set({ stream: null });
  }

  destroy(): void {
    this.stopSharing();
    this.closeIncoming();
  }

  private set(patch: Partial<ScreenState>): void {
    this.state = { ...this.state, ...patch };
    this.onChange(this.state);
  }
}
