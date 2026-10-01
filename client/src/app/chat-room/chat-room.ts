import { Component, inject, signal, computed, DestroyRef, ElementRef, viewChild, afterRenderEffect } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';         // formats message times
import { Navbar } from '../navbar/navbar';
import { Auth } from '../auth';
import { GroupService, Group, Channel, GroupMember } from '../group';
import { ChatService } from '../chat';
import { readableInk, LIGHT_INK } from '../theme';

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

  // signals, since they're set in subscribe and the app is zoneless
  group = signal<Group | undefined>(undefined);
  channels = signal<Channel[]>([]);                 // the group's rooms, for the sidebar
  channel = signal<Channel | undefined>(undefined); // the open room

  // each member's name and picture, keyed by email (a message's sender)
  members = signal(new Map<string, GroupMember>());

  me = this.auth.email;   // to mark my own messages

  // the group's theme carries into its rooms. fallback until the group loads.
  theme = computed(() => this.group()?.theme ?? '#5FA8D3');

  // readable text on that theme (theme.ts). hardcoded white only managed 2.6:1.
  ink = computed(() => readableInk(this.theme()));

  // a class for the placeholder colour, which can't be set inline
  onDark = computed(() => this.ink() === LIGHT_INK);

  // ChatService's own signals, not copies, so socket updates redraw the page
  messages = this.chat.messages;
  present = this.chat.present;
  notice = this.chat.notice;        // "x joined" / "x left"
  error = this.chat.error;

  // members only get the message box (the server refuses others anyway)
  canPost = computed(() => this.group()?.memberEmails.includes(this.me) ?? false);

  draft = '';   // plain, [(ngModel)] writes it

  // an uploaded image waiting to be sent
  pendingImage = signal('');       // its path, '' when none
  uploading = signal(false);
  uploadError = signal('');

  // the server's limits, checked first to avoid a pointless upload. the server still checks.
  private readonly imageTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  private readonly maxImageBytes = 5 * 1024 * 1024;

  // the message list (#scroller)
  private scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  constructor() {
    // subscribed, because switching rooms reuses this component
    this.route.paramMap.subscribe(params => {
      const groupId = params.get('groupId') ?? '';
      const channelId = params.get('channelId') ?? '';

      this.groupService.getGroups().subscribe(groups => {
        this.group.set(groups.find(g => g._id === groupId));
      });

      // once per room, not per message
      this.groupService.getMembers(groupId).subscribe(members => {
        this.members.set(new Map(members.map(m => [m.email, m])));
      });

      this.groupService.getChannels(groupId).subscribe(channels => {
        this.channels.set(channels);
        this.channel.set(channels.find(c => c._id === channelId));
      });

      // joining also leaves the old room. the server checks membership.
      this.chat.joinRoom(channelId, this.me);
    });

    // scroll to the newest message after each render. reading messages() makes it re-run.
    afterRenderEffect(() => {
      this.messages();
      this.scrollToBottom();
    });

    // the socket is shared, so leave the room explicitly when the page goes
    inject(DestroyRef).onDestroy(() => this.chat.leaveRoom());
  }

  // also called when an image loads, since it has no height until then
  scrollToBottom() {
    const list = this.scroller()?.nativeElement;
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
  }

  // image step one: upload as soon as it's picked
  onImageChosen(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';      // so picking the same file again still fires (change)
    if (!file) {
      return;
    }

    this.uploadError.set('');
    if (!this.imageTypes.includes(file.type)) {
      this.uploadError.set('Choose a PNG, JPEG, GIF or WebP image.');
      return;
    }
    if (file.size > this.maxImageBytes) {
      this.uploadError.set('Images must be 5 MB or smaller.');
      return;
    }

    this.uploading.set(true);
    this.chat.uploadImage(file).subscribe({
      next: res => {
        this.pendingImage.set(res.imageUrl);
        this.uploading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.uploadError.set(err.error?.error ?? 'Could not upload that image.');
        this.uploading.set(false);
      },
    });
  }

  removeImage() {
    this.pendingImage.set('');
  }

  imageSrc(imageUrl: string) {
    return this.chat.imageSrc(imageUrl);
  }

  onSend() {
    const body = this.draft.trim();
    const image = this.pendingImage();
    if (!body && !image) {        // needs text or an image
      return;
    }
    // no email sent, the server uses the socket's join. image step two.
    this.chat.send(body, image);
    this.draft = '';
    this.pendingImage.set('');
  }

  // the sender's name. someone who has left falls back to their email.
  nameFor(email: string) {
    return this.members().get(email)?.username || email;
  }

  initialFor(email: string) {
    return (this.nameFor(email).charAt(0) || '?').toUpperCase();
  }

  // their picture's address, or '' to show the initial
  avatarFor(email: string) {
    const url = this.members().get(email)?.avatarUrl;
    return url ? this.auth.avatarSrc(url) : '';
  }

  // time only for today, date and time for older messages
  timeFormat(at: string) {
    return new Date(at).toDateString() === new Date().toDateString() ? 'shortTime' : 'd MMM, h:mm a';
  }

  // the spec's admin indicator. group admin is stored on the group.
  isAdmin(email: string) {
    return this.group()?.adminEmails.includes(email) ?? false;
  }
}
