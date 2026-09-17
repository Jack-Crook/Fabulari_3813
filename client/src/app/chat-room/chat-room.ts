import { Component, inject, signal, computed, DestroyRef, ElementRef, viewChild, afterRenderEffect } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';       // lets the html use [(ngModel)] on the message box
import { DatePipe } from '@angular/common';         // formats each message's ISO timestamp as a time
import { Navbar } from '../navbar/navbar';
import { Auth } from '../auth';
import { GroupService, Group, Channel } from '../group';
import { ChatService } from '../chat';

@Component({
  selector: 'app-chat-room',
  imports: [Navbar, RouterLink, FormsModule, DatePipe],
  templateUrl: './chat-room.html',
  styleUrl: './chat-room.css',
})
export class ChatRoom {
  private groupService = inject(GroupService);
  private route = inject(ActivatedRoute);
  private auth = inject(Auth);
  private chat = inject(ChatService);

  // signals because the app is zoneless, same reason as the dashboard and group view
  group = signal<Group | undefined>(undefined);
  channels = signal<Channel[]>([]);                 // every room in this group, listed down the left
  channel = signal<Channel | undefined>(undefined); // the room actually open

  me = this.auth.email;   // used to work out which messages are mine

  // the group's colour, with a fallback for the moment before the fetch comes back. the spec
  // says the theme is the group's customisation and that it extends into its chat rooms, so
  // the banner, the selected room and the message bar all read from this.
  theme = computed(() => this.group()?.theme ?? '#5FA8D3');

  // the live state lives in ChatService, not here. these are the service's own signals handed
  // straight to the template, not copies, so when a socket event updates one the page redraws.
  messages = this.chat.messages;
  present = this.chat.present;      // who is in the room right now, from the server
  notice = this.chat.notice;        // "someone joined" / "someone left"
  error = this.chat.error;

  // only members get the message box. the server refuses a non member's join anyway, which is
  // what happens to the super admin, but there's no point offering a box that can't send.
  canPost = computed(() => this.group()?.memberEmails.includes(this.me) ?? false);

  draft = '';   // plain property, [(ngModel)] writes it from a DOM event

  // the scrolling message list in the template, marked #scroller
  private scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  constructor() {
    // subscribed rather than read once, because clicking another room in the sidebar reuses
    // this component and only swaps the :channelId in the url
    this.route.paramMap.subscribe(params => {
      const groupId = params.get('groupId') ?? '';
      const channelId = params.get('channelId') ?? '';

      this.groupService.getGroups().subscribe(groups => {
        this.group.set(groups.find(g => g._id === groupId));
      });

      this.groupService.getChannels(groupId).subscribe(channels => {
        this.channels.set(channels);
        this.channel.set(channels.find(c => c._id === channelId));
      });

      // joining a new room also leaves the old one on the server, so switching rooms in the
      // sidebar needs nothing extra. the server checks membership before letting us in.
      this.chat.joinRoom(channelId, this.me);
    });

    // keep the newest message in view. afterRenderEffect runs after angular has drawn the page,
    // so the new message is already in the DOM and scrollHeight includes it. reading messages()
    // inside is what makes this re-run every time the list changes.
    afterRenderEffect(() => {
      this.messages();
      const list = this.scroller()?.nativeElement;
      if (list) {
        list.scrollTop = list.scrollHeight;
      }
    });

    // navigating away inside the app doesn't close the socket, it's shared app wide, so without
    // this you'd still be listed in the room after going back to the dashboard
    inject(DestroyRef).onDestroy(() => this.chat.leaveRoom());
  }

  onSend() {
    const body = this.draft.trim();
    if (!body) {
      return;
    }
    // no email sent with it. the server takes the sender from this socket's join, so a message
    // can't be posted as somebody else.
    this.chat.send(body);
    this.draft = '';
  }

  // group admins get an indicator next to their name in chat, the spec asks for this.
  // it's a lookup in the group's adminEmails rather than a check on the user's role, because
  // that's where group admin actually lives.
  isAdmin(email: string) {
    return this.group()?.adminEmails.includes(email) ?? false;
  }
}
