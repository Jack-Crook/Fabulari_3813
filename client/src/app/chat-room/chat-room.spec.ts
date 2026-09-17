import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';

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
  };
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

    // no email goes with it, the server takes the sender from the socket's join
    expect(chat.send).toHaveBeenCalledWith('hello room');
    expect(component.draft).toBe('');
  });

  it('does not send an empty message', async () => {
    await build();
    load();

    component.draft = '   ';
    component.onSend();

    expect(chat.send).not.toHaveBeenCalled();
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
