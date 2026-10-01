import { Service, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';          // image uploads are normal http, not socket events
import { io, Socket } from 'socket.io-client';

// one message, as stored and broadcast. text, an image, or both.
export interface ChatMessage {
  _id: string;
  channelId: string;
  sender: string;         // an email, the identifier everywhere
  body: string;
  imageUrl: string;       // /uploads/<uuid>.png, or '' for no image
  at: string;             // ISO, so string order = date order
}

// a join or leave notice. the email, not a ready-made sentence, so the page can show the display name
export interface RoomNotice {
  email: string;
  event: 'joined' | 'left';
}

// the joinRoom ack, sent only to the joiner
interface JoinResult {
  history?: ChatMessage[];
  present?: string[];
  more?: boolean;       // older messages exist than the ones sent
  error?: string;
}

// the loadOlder ack: the page of messages before the oldest one shown
interface OlderResult {
  messages?: ChatMessage[];
  more?: boolean;
  error?: string;
}

@Service()
export class ChatService {
  private http = inject(HttpClient);
  private socket?: Socket;

  // the current room, so it can be rejoined after a reconnect (a new socket starts in no room)
  private currentRoom?: { channelId: string; email: string };

  private apiUrl = 'http://localhost:3000';   // sockets share the api's http server

  // signals, because socket callbacks run outside angular and the app is zoneless. a plain
  // property would update but the screen wouldn't redraw.
  messages = signal<ChatMessage[]>([]);
  present = signal<string[]>([]);      // who is in the room, from the presence event
  notice = signal<RoomNotice | null>(null);   // someone joined or left, shown briefly
  error = signal('');
  removed = signal(false);             // the server took us out of the room (removed, banned, room deleted)
  typing = signal('');                 // the email of whoever is typing right now, '' for no one
  more = signal(false);                // older messages exist than the ones loaded
  loadingOlder = signal(false);

  private typingTimer?: ReturnType<typeof setTimeout>;
  private lastTypingSent = 0;

  // one connection, reused for every room
  private connect(): Socket {
    if (this.socket) {
      return this.socket;
    }

    const socket = io(this.apiUrl);
    this.socket = socket;

    socket.on('newMessage', (message: ChatMessage) => {
      // a new array, since a signal only notifies when the reference changes
      this.messages.update(list => [...list, message]);
    });

    socket.on('presence', (people: string[]) => this.present.set(people));

    // someone else is typing. cleared after 3s unless another one arrives, since there's no
    // "stopped typing" event: going quiet is how it stops
    socket.on('typing', ({ email }: { email: string }) => {
      this.typing.set(email);
      clearTimeout(this.typingTimer);
      this.typingTimer = setTimeout(() => this.typing.set(''), 3000);
    });

    // the spec wants a notice as well as the live list
    socket.on('userJoined', ({ email }: { email: string }) => this.flash(email, 'joined'));
    socket.on('userLeft', ({ email }: { email: string }) => this.flash(email, 'left'));

    // the server has taken us out of the room: we were removed or banned from the group, or the
    // room or group was deleted. the reason is shown, and the page hides the message box.
    socket.on('removedFromRoom', ({ reason }: { reason: string }) => {
      this.currentRoom = undefined;     // so a reconnect doesn't try to rejoin
      this.removed.set(true);
      this.present.set([]);
      this.notice.set(null);
      this.error.set(reason);
    });

    socket.on('connect_error', () => this.error.set('Lost connection to the chat server.'));

    // rejoin after a reconnect. 'reconnect' doesn't fire on the first connection, so no double join.
    socket.io.on('reconnect', () => {
      this.error.set('');
      if (this.currentRoom) {
        this.joinRoom(this.currentRoom.channelId, this.currentRoom.email);
      }
    });

    return socket;
  }

  // shows a notice for 4s. the check stops an old timer clearing a newer notice.
  private flash(email: string, event: RoomNotice['event']) {
    const notice = { email, event };
    this.notice.set(notice);
    setTimeout(() => this.notice.update(current => (current === notice ? null : current)), 4000);
  }

  // the server checks membership, then remembers the email for this socket
  joinRoom(channelId: string, email: string) {
    const socket = this.connect();
    this.currentRoom = { channelId, email };

    this.messages.set([]);     // clear the old room first so it never shows
    this.present.set([]);       // under the new room's name
    this.notice.set(null);
    this.error.set('');
    this.removed.set(false);
    this.typing.set('');
    this.more.set(false);

    socket.emit('joinRoom', { channelId, email }, (res: JoinResult) => {
      // ignore a late reply from a room already left (quick room switching)
      if (this.currentRoom?.channelId !== channelId) {
        return;
      }
      if (res?.error) {
        this.error.set(res.error);
        return;
      }
      this.messages.set(res.history ?? []);   // already oldest first
      this.more.set(res.more ?? false);
      this.present.set(res.present ?? []);
    });
  }

  // image step one: upload and get back the stored path. email and channelId go BEFORE the file
  // because multer reads the form in order and the membership check needs them.
  uploadImage(file: File) {
    const form = new FormData();
    form.append('email', this.currentRoom?.email ?? '');
    form.append('channelId', this.currentRoom?.channelId ?? '');
    form.append('image', file);
    return this.http.post<{ imageUrl: string }>(`${this.apiUrl}/uploads`, form);
  }

  // stored paths are relative, this makes them loadable by an <img>
  imageSrc(imageUrl: string) {
    return `${this.apiUrl}${imageUrl}`;
  }

  // no email sent: the server uses the socket's join, so nobody can post as someone else.
  // image step two is this, with the uploaded path.
  send(body: string, imageUrl = '') {
    if (!this.socket) {
      this.error.set('Not connected to the chat server.');
      return;
    }
    this.socket.emit('sendMessage', { body, imageUrl }, (res: { ok?: boolean; error?: string }) => {
      if (res?.error) {
        this.error.set(res.error);
      }
    });
  }

  // leaving the page doesn't disconnect the shared socket, so leave explicitly
  // the 50 messages before the oldest one shown, put in front of the list. a room's history can be
  // any length, so it comes a page at a time instead of all at once.
  loadOlder() {
    const oldest = this.messages()[0];
    if (!this.socket || !oldest || this.loadingOlder()) {
      return;
    }
    this.loadingOlder.set(true);
    this.socket.emit('loadOlder', { before: oldest._id }, (res: OlderResult) => {
      this.loadingOlder.set(false);
      if (res?.error) {
        this.error.set(res.error);
        return;
      }
      this.messages.update(list => [...(res.messages ?? []), ...list]);
      this.more.set(res.more ?? false);
    });
  }

  // tells the room I'm typing. called on every keystroke but sent at most every 2s, which is plenty
  // for a 3s indicator and saves a message per key
  notifyTyping() {
    const now = Date.now();
    if (!this.socket || now - this.lastTypingSent < 2000) {
      return;
    }
    this.lastTypingSent = now;
    this.socket.emit('typing');
  }

  // calls `callback` with the group id whenever a request is raised or actioned anywhere, so a
  // page showing requests or memberships can refetch. returns the function that stops listening,
  // for the page to call when it's destroyed.
  onRequestsChanged(callback: (groupId: string | null) => void): () => void {
    const socket = this.connect();
    const handler = ({ groupId }: { groupId: string | null }) => callback(groupId);
    socket.on('requestsChanged', handler);
    return () => socket.off('requestsChanged', handler);
  }

  leaveRoom() {
    this.socket?.emit('leaveRoom');
    this.currentRoom = undefined;     // so a reconnect doesn't rejoin
    this.messages.set([]);
    this.present.set([]);
    this.notice.set(null);
    this.removed.set(false);
    this.typing.set('');
    this.more.set(false);
  }
}
