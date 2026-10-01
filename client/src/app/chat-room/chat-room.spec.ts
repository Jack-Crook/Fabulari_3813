import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';

import { ChatRoom } from './chat-room';
import { ChatService, ChatMessage, RoomNotice } from '../chat';
import { GroupMember } from '../group';
import { testProviders, signIn, signOut, makeGroup, makeChannel, flushByUrl } from '../testing';

// a fake ChatService, so no real socket is opened. same signals, and vi.fn() methods to check calls.
function fakeChat() {
  return {
    messages: signal<ChatMessage[]>([]),
    present: signal<string[]>([]),
    notice: signal<RoomNotice | null>(null),
    error: signal(''),
    removed: signal(false),
    typing: signal(''),
    more: signal(false),
    loadingOlder: signal(false),
    notifyTyping: vi.fn(),
    loadOlder: vi.fn(),
    joinRoom: vi.fn(),
    send: vi.fn(),
    leaveRoom: vi.fn(),
    uploadImage: vi.fn(() => of({ imageUrl: '/uploads/abc.png' })),
    imageSrc: (url: string) => `http://localhost:3000${url}`,
  };
}

// a fake (change) event. the size can be overridden for the size limit test.
function pick(type = 'image/png', size?: number) {
  const file = new File(['fake image bytes'], 'photo', { type });
  if (size !== undefined) {
    Object.defineProperty(file, 'size', { value: size });
  }
  return { target: { files: [file], value: 'photo' } } as unknown as Event;
}

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    _id: 'm1',
    channelId: 'c1',
    sender: 'admin@test.com',
    body: 'Has everyone finished chapter 4 yet?',
    imageUrl: '',
    at: '2026-09-17T04:00:00.000Z',
    ...overrides,
  };
}

describe('ChatRoom', () => {
  let component: ChatRoom;
  let fixture: ComponentFixture<ChatRoom>;
  let mock: HttpTestingController;
  let chat: ReturnType<typeof fakeChat>;

  async function build(email = 'member@test.com') {
    signIn(email);
    fixture = TestBed.createComponent(ChatRoom);
    component = fixture.componentInstance;
    mock = TestBed.inject(HttpTestingController);
    await fixture.whenStable();
  }

  // '/members' first, since its url also contains '/groups'
  function load(group = makeGroup(), members: GroupMember[] = []) {
    flushByUrl(mock, { '/members': members, '/groups': [group], '/channels': [makeChannel()] });
  }

  beforeEach(async () => {
    chat = fakeChat();
    await TestBed.configureTestingModule({
      imports: [ChatRoom],
      providers: [
        ...testProviders(),
        { provide: ChatService, useValue: chat },
        // the url this page would be opened on, /groups/g1/channels/c1
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ groupId: 'g1', channelId: 'c1' })) } },
      ],
    }).compileComponents();
    signOut();
  });

  afterEach(() => signOut());

  it('should create', async () => {
    await build();
    load();
    expect(component).toBeTruthy();
  });

  it('joins the room in the url as the signed in user', async () => {
    await build('member@test.com');
    load();

    expect(chat.joinRoom).toHaveBeenCalledWith('c1', 'member@test.com');
  });

  it('marks a sender who is an admin of this group', async () => {
    await build();
    load();

    // the admin indicator comes from the group's adminEmails
    expect(component.isAdmin('admin@test.com')).toBe(true);
    expect(component.isAdmin('member@test.com')).toBe(false);
  });

  it('takes its colour from the group', async () => {
    await build();
    load(makeGroup({ theme: '#7B3FF2' }));

    // the group's theme carries into its rooms
    expect(component.theme()).toBe('#7B3FF2');
  });

  it('falls back to the default colour before the group arrives', async () => {
    await build();

    expect(component.theme()).toBe('#5FA8D3');
    load();
  });

  it('renders messages and presence pushed by the socket', async () => {
    await build();
    load();

    // what the service does when the server emits newMessage and presence
    chat.messages.set([makeMessage()]);
    chat.present.set(['admin@test.com', 'member@test.com']);
    await fixture.whenStable();

    const page: HTMLElement = fixture.nativeElement;
    expect(page.querySelector('.message-body')?.textContent).toContain('chapter 4');
    expect(page.querySelectorAll('.person').length).toBe(2);
  });

  it('sends the trimmed draft and clears the box', async () => {
    await build();
    load();

    component.draft = '  hello room  ';
    component.onSend();

    // no email sent, the server uses the socket's join. '' = no image
    expect(chat.send).toHaveBeenCalledWith('hello room', '');
    expect(component.draft).toBe('');
  });

  it('does not send an empty message', async () => {
    await build();
    load();

    component.draft = '   ';
    component.onSend();

    expect(chat.send).not.toHaveBeenCalled();
  });

  it('uploads a picked image and holds it until send', async () => {
    await build();
    load();

    component.onImageChosen(pick());

    expect(chat.uploadImage).toHaveBeenCalled();
    expect(component.pendingImage()).toBe('/uploads/abc.png');
    expect(chat.send).not.toHaveBeenCalled();     // picking isn't sending
  });

  it('sends the attached image with the text, then clears both', async () => {
    await build();
    load();

    component.onImageChosen(pick());
    component.draft = 'look at this';
    component.onSend();

    // image step two: the uploaded path goes over the socket
    expect(chat.send).toHaveBeenCalledWith('look at this', '/uploads/abc.png');
    expect(component.pendingImage()).toBe('');
    expect(component.draft).toBe('');
  });

  it('sends an image on its own with no text', async () => {
    await build();
    load();

    component.onImageChosen(pick());
    component.onSend();

    expect(chat.send).toHaveBeenCalledWith('', '/uploads/abc.png');
  });

  it('refuses a file that is not an allowed image before uploading it', async () => {
    await build();
    load();

    component.onImageChosen(pick('image/svg+xml'));

    expect(chat.uploadImage).not.toHaveBeenCalled();
    expect(component.uploadError()).toContain('PNG, JPEG, GIF or WebP');
  });

  it('refuses an image over 5 MB before uploading it', async () => {
    await build();
    load();

    component.onImageChosen(pick('image/jpeg', 6 * 1024 * 1024));

    expect(chat.uploadImage).not.toHaveBeenCalled();
    expect(component.uploadError()).toContain('5 MB');
  });

  it('shows the server\'s reason when an upload is refused', async () => {
    await build();
    load();
    chat.uploadImage.mockReturnValueOnce(throwError(() =>
      new HttpErrorResponse({ status: 403, error: { error: 'You are not a member of this group' } })));

    component.onImageChosen(pick());

    expect(component.uploadError()).toBe('You are not a member of this group');
    expect(component.pendingImage()).toBe('');
    expect(component.uploading()).toBe(false);
  });

  it('renders an image message', async () => {
    await build();
    load();

    chat.messages.set([makeMessage({ body: '', imageUrl: '/uploads/abc.png' })]);
    await fixture.whenStable();

    const img: HTMLImageElement | null = fixture.nativeElement.querySelector('.message-image');
    expect(img?.getAttribute('src')).toBe('http://localhost:3000/uploads/abc.png');
    expect(img?.getAttribute('alt')).toBe('Image from admin@test.com');
    // an image only message has no empty text bubble under it
    expect(fixture.nativeElement.querySelector('.message-body')).toBeNull();
  });

  it('only offers the message box to members', async () => {
    // the super admin is in no groups
    await build('super@test.com');
    load();

    expect(component.canPost()).toBe(false);
  });

  it('leaves the room when the page is destroyed', async () => {
    await build();
    load();

    fixture.destroy();

    // the socket is shared, so leaving is explicit
    expect(chat.leaveRoom).toHaveBeenCalled();
  });

  it('shows each sender\'s picture and display name next to their message', async () => {
    await build();
    load(makeGroup(), [{ email: 'admin@test.com', username: 'Ada', avatarUrl: '/uploads/ada.png' }]);
    chat.messages.set([makeMessage({ sender: 'admin@test.com' })]);
    await fixture.whenStable();

    const page = fixture.nativeElement as HTMLElement;
    expect(page.querySelector('img.chat-avatar')?.getAttribute('src')).toBe('http://localhost:3000/uploads/ada.png');
    expect(page.querySelector('.message-sender')?.textContent).toContain('Ada');
  });

  it('falls back to the initial, and to the email, for a sender with no picture or who has left', async () => {
    await build();
    load(makeGroup(), [{ email: 'admin@test.com', username: 'Ada', avatarUrl: '' }]);

    expect(component.avatarFor('admin@test.com')).toBe('');
    expect(component.initialFor('admin@test.com')).toBe('A');
    // not in the members list any more, e.g. banned since they wrote it
    expect(component.nameFor('gone@test.com')).toBe('gone@test.com');
    expect(component.initialFor('gone@test.com')).toBe('G');
  });

  it('lists who is in the room by display name, with the email on hover', async () => {
    await build();
    load(makeGroup(), [{ email: 'admin@test.com', username: 'Ada', avatarUrl: '' }]);
    chat.present.set(['admin@test.com']);
    await fixture.whenStable();

    const person = (fixture.nativeElement as HTMLElement).querySelector('.person')!;
    expect(person.textContent).toContain('Ada');
    expect(person.getAttribute('title')).toBe('admin@test.com');
  });

  it('shows who joined by display name', async () => {
    await build();
    load(makeGroup(), [{ email: 'admin@test.com', username: 'Ada', avatarUrl: '' }]);
    chat.notice.set({ email: 'admin@test.com', event: 'joined' });
    await fixture.whenStable();

    const notice = (fixture.nativeElement as HTMLElement).querySelector('.notice')!;
    expect(notice.textContent?.trim()).toBe('Ada joined');
  });

  it('hides the message box once the server takes us out of the room', async () => {
    await build('member@test.com');
    load();
    expect(component.canPost()).toBe(true);

    // what the service does when the server emits removedFromRoom
    chat.removed.set(true);
    chat.error.set('You were banned from this group');
    await fixture.whenStable();

    const page = fixture.nativeElement as HTMLElement;
    expect(component.canPost()).toBe(false);
    expect(page.querySelector('.composer')).toBeNull();
    expect(page.querySelector('.chat-error')?.textContent).toContain('banned');
  });

  it('shows who is typing, by display name', async () => {
    await build();
    load(makeGroup(), [{ email: 'admin@test.com', username: 'Ada', avatarUrl: '' }]);
    chat.typing.set('admin@test.com');
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).querySelector('.typing')?.textContent).toContain('Ada is typing');
  });

  it('tells the service on every keystroke, and the service decides how often to send', async () => {
    await build();
    load();
    component.onTyping();
    expect(chat.notifyTyping).toHaveBeenCalled();
  });

  it('offers older messages only when there are more, and asks the service for them', async () => {
    await build();
    load();
    chat.messages.set([makeMessage()]);
    await fixture.whenStable();
    const page = fixture.nativeElement as HTMLElement;
    expect(page.querySelector('.more-button')).toBeNull();

    chat.more.set(true);
    await fixture.whenStable();
    (page.querySelector('.more-button') as HTMLButtonElement).click();
    expect(chat.loadOlder).toHaveBeenCalled();
  });

  it('shows only the time for today\'s messages, and the date as well for older ones', async () => {
    await build();
    load();

    expect(component.timeFormat(new Date().toISOString())).toBe('shortTime');
    expect(component.timeFormat('2026-01-15T10:00:00.000Z')).toBe('d MMM, h:mm a');
  });
});
