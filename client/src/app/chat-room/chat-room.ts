import { Component, inject, signal, computed } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Navbar } from '../navbar/navbar';
import { Auth } from '../auth';
import { GroupService, Group, Channel } from '../group';

@Component({
  selector: 'app-chat-room',
  imports: [Navbar, RouterLink],
  templateUrl: './chat-room.html',
  styleUrl: './chat-room.css',
})
export class ChatRoom {
  private groupService = inject(GroupService);
  private route = inject(ActivatedRoute);
  private auth = inject(Auth);

  // signals because the app is zoneless, same reason as the dashboard and group view
  group = signal<Group | undefined>(undefined);
  channels = signal<Channel[]>([]);                 // every room in this group, listed down the left
  channel = signal<Channel | undefined>(undefined); // the room actually open

  me = this.auth.email;   // used to work out which messages are mine

  // the group's colour, with a fallback for the moment before the fetch comes back. the spec
  // says the theme is the group's customisation and that it extends into its chat rooms, so
  // the banner, the selected room and the message bar all read from this.
  theme = computed(() => this.group()?.theme ?? '#5FA8D3');

  // Messages are mock until socket.io in phase 2. They're built from the group's real member
  // list rather than hardcoded addresses, so the admin indicator below actually has a group
  // admin to mark — with fixed emails it would mark nobody in most groups.
  messages = computed(() => {
    const members = this.group()?.memberEmails ?? [];
    if (members.length === 0) {
      return [];
    }
    const first = members[0];
    const second = members[1] ?? members[0];
    return [
      { sender: first,  body: 'Has everyone finished chapter 4 yet?' },
      { sender: second, body: 'Just started it last night, no spoilers please' },
      { sender: first,  body: 'No promises' },
      { sender: second, body: 'I finished the whole book already sorry' },
    ];
  });

  // who is currently in the room. mock for the same reason — real presence needs socket.io,
  // which is phase 2. taking the first few members keeps it consistent with the messages above.
  currentlyIn = computed(() => (this.group()?.memberEmails ?? []).slice(0, 3));

  constructor() {
    // subscribed rather than read once, because clicking another room in the sidebar reuses
    // this component and only swaps the :channelId in the url
    this.route.paramMap.subscribe(params => {
      const groupId = params.get('groupId') ?? '';
      const channelId = params.get('channelId') ?? '';

      this.groupService.getGroups().subscribe(groups => {
        this.group.set(groups.find(g => g.id === groupId));
      });

      this.groupService.getChannels(groupId).subscribe(channels => {
        this.channels.set(channels);
        this.channel.set(channels.find(c => c.id === channelId));
      });
    });
  }

  // group admins get an indicator next to their name in chat, the spec asks for this.
  // it's a lookup in the group's adminEmails rather than a check on the user's role, because
  // that's where group admin actually lives.
  isAdmin(email: string) {
    return this.group()?.adminEmails.includes(email) ?? false;
  }
}
