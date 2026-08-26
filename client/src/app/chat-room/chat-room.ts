import { Component, inject, signal } from '@angular/core';
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

  me = this.auth.getUser()?.email ?? '';   // used to work out which messages are mine

  // messages aren't stored anywhere yet, there's no /messages endpoint and no socket.io.
  // these are hardcoded purely so the chat layout can be seen. real messages are phase 2.
  // the senders are deliberately real members of Book Club — the super admin isn't used here,
  // because they can't be a member of any group (server.js rejects it), so showing them
  // chatting would contradict the role model.
  messages = [
    { sender: 'jack@123',        body: 'Has everyone finished chapter 4 yet?' },
    { sender: 'hello@hello.com', body: 'Just started it last night, no spoilers please' },
    { sender: 'jack@123',        body: 'No promises' },
    { sender: 'hello@hello.com', body: 'I finished the whole book already sorry' },
  ];

  // who is currently in the room. socket.io gives a live list in phase 2, this is a placeholder
  currentlyIn = ['jack@123', 'hello@hello.com'];

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

  // group admins get an indicator next to their name in chat, the spec asks for this
  isAdmin(email: string) {
    return this.group()?.adminEmails.includes(email) ?? false;
  }
}
