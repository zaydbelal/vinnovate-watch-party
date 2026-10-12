import type { ComponentType } from 'react';
import { ChatPanel } from './ChatPanel';
import { DiscoverPanel } from './DiscoverPanel';
import { PeoplePanel } from './PeoplePanel';
import { PlaylistPanel } from './PlaylistPanel';
import { PollsPanel } from './PollsPanel';

export interface SidebarPanel {
  id: string;
  label: string;
  component: ComponentType;
}

/**
 * Sidebar tabs, in display order. To add a panel, create a component in this
 * folder and add a line here.
 */
export const panels: SidebarPanel[] = [
  { id: 'chat', label: '💬 Chat', component: ChatPanel },
  { id: 'discover', label: '🎞 Discover', component: DiscoverPanel },
  { id: 'playlist', label: '📃 Playlist', component: PlaylistPanel },
  { id: 'polls', label: '📊 Polls', component: PollsPanel },
  { id: 'people', label: '👥 People', component: PeoplePanel },
];
