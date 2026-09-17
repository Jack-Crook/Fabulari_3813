import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';

import { ChatRoom } from './chat-room';
import { ChatService, ChatMessage } from '../chat';
import { testProviders, signIn, signOut, makeGroup, makeChannel, flushByUrl } from '../testing';

// A stand-in for ChatService. The real one opens a socket to localhost:3000 the moment a room is
// joined, which a unit test must not do, for the same reason provideHttpClientTesting stops the
// http services reaching the server. The fake has the same signals, so the component reads it
// exactly as it reads the real one, and its methods are vi.fn() so a test can ask what was called.
function fakeChat() {
  return {
    messages: signal<ChatMessage[]>([]),
    present: signal<string[]>([]),
    notice: signal(''),
    error: signal(''),
    joinRoom: vi.fn(),
    send: vi.fn(),
    leaveRoom: vi.fn(),
    uploadImage: vi.fn(() => of({ imageUrl: '/uploads/abc.png' })),
    imageSrc: (url: string) => `http://localhost:3000${url}`,
  };
}

// what the browser hands (change) when a file is picked. size can be overridden, because a test
// shouldn't have to build a real 6 MB file to check the size limit.
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

  function load(group = makeGroup()) {
    flushByUrl(mock, { '/groups': [group], '/channels': [makeChannel()] });
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

    // the spec asks for an indicator when the sender is that group's admin. it's a lookup in
    // adminEmails, not a check on the user's role, because that's where group admin lives.
    expect(component.isAdmin('admin@test.com')).toBe(true);
    expect(component.isAdmin('member@test.com')).toBe(false);
  });

  it('takes its colour from the group', async () => {
    await build();
    load(makeGroup({ theme: '#7B3FF2' }));

    // the spec says the theme colour is the group's customisation and that it extends into
    // that group's chat rooms
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

    // no email goes with it, the server takes the sender from the socket's join. '' = no image
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

    // step two of an image message: the path from the upload goes out over the socket
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
    // the super admin isn't a member of any group, and the server would refuse their join
    await build('super@test.com');
    load();

    expect(component.canPost()).toBe(false);
  });

  it('leaves the room when the page is destroyed', async () => {
    await build();
    load();

    fixture.destroy();

    // the socket is shared app wide and stays open, so leaving has to be said explicitly
    expect(chat.leaveRoom).toHaveBeenCalled();
  });
});
