import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { ChatRoom } from './chat-room';
import { testProviders, signIn, signOut, makeGroup, makeChannel, flushByUrl } from '../testing';

describe('ChatRoom', () => {
  let component: ChatRoom;
  let fixture: ComponentFixture<ChatRoom>;
  let mock: HttpTestingController;

  async function build(email = 'member@test.com') {
    signIn(email);
    fixture = TestBed.createComponent(ChatRoom);
    component = fixture.componentInstance;
    mock = TestBed.inject(HttpTestingController);
    await fixture.whenStable();
  }

  function load(group = makeGroup({ id: '' })) {
    flushByUrl(mock, { '/groups': [group], '/channels': [makeChannel()] });
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChatRoom],
      providers: testProviders(),
    }).compileComponents();
    signOut();
  });

  afterEach(() => signOut());

  it('should create', async () => {
    await build();
    load();
    expect(component).toBeTruthy();
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
    load(makeGroup({ id: '', theme: '#7B3FF2' }));

    // the spec says the theme colour is the group's customisation and that it extends into
    // that group's chat rooms
    expect(component.theme()).toBe('#7B3FF2');
  });

  it('falls back to the default colour before the group arrives', async () => {
    await build();

    expect(component.theme()).toBe('#5FA8D3');
    load();
  });

  it('builds its mock messages from the group\'s real members', async () => {
    await build();
    load(makeGroup({ id: '', memberEmails: ['admin@test.com', 'member@test.com'] }));

    // messages are mock until socket.io in phase 2, but they're built from the real member
    // list — with hardcoded addresses the admin indicator would have nobody to mark
    expect(component.messages().length).toBe(4);
    expect(component.messages()[0].sender).toBe('admin@test.com');
    expect(component.currentlyIn()).toEqual(['admin@test.com', 'member@test.com']);
  });

  it('shows nothing rather than fake senders when the group has no members', async () => {
    await build();
    load(makeGroup({ id: '', memberEmails: [] }));

    expect(component.messages()).toEqual([]);
  });
});
