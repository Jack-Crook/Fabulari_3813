import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { GroupView } from './group-view';
import { testProviders, signIn, signOut, makeGroup, makeChannel, makeRequest, flushByUrl } from '../testing';

describe('GroupView', () => {
  let component: GroupView;
  let fixture: ComponentFixture<GroupView>;
  let mock: HttpTestingController;

  async function build(email: string, role = 'user') {
    signIn(email, role);
    fixture = TestBed.createComponent(GroupView);
    component = fixture.componentInstance;
    mock = TestBed.inject(HttpTestingController);
    await fixture.whenStable();
  }

  // the test router has no :id, so the group id is ''
  // two requests calls: the group's room proposals, and my own pending request to join
  function load(group = makeGroup({ _id: '' }), proposals: any[] = [], myJoinRequests: any[] = []) {
    flushByUrl(mock, { '/groups': [group], '/channels': [makeChannel()] });
    mock.match(r => r.url.includes('/requests')).forEach(req =>
      req.flush(req.request.params.get('type') === 'group-join' ? myJoinRequests : proposals));
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GroupView],
      providers: testProviders(),
    }).compileComponents();
    signOut();
  });

  afterEach(() => signOut());

  it('should create', async () => {
    await build('member@test.com');
    load();
    expect(component).toBeTruthy();
  });

  it('recognises an admin of this group', async () => {
    await build('admin@test.com');
    load();

    // same check as the admin page's guard
    expect(component.isGroupAdmin()).toBe(true);
    expect(component.isMember()).toBe(true);
  });

  it('treats a plain member as a member but not an admin', async () => {
    await build('member@test.com');
    load();

    expect(component.isGroupAdmin()).toBe(false);
    expect(component.isMember()).toBe(true);
  });

  it('treats a non-member as neither', async () => {
    await build('stranger@test.com');
    load();

    // non-members can see the page but can't propose rooms
    expect(component.isMember()).toBe(false);
  });

  it('proposes a room rather than creating one', async () => {
    await build('member@test.com');
    load();

    component.proposedName = 'Spoilers';
    component.onPropose();

    // members propose rooms, admins approve them
    const req = mock.expectOne('http://localhost:3000/requests');
    expect(req.request.body.type).toBe('channel-create');
    expect(req.request.body.payload.name).toBe('Spoilers');
    req.flush(makeRequest());

    load();   // reload after proposing
    expect(component.formSuccess()).toContain('Spoilers');
  });

  it('surfaces the 409 when that room already exists', async () => {
    await build('member@test.com');
    load();

    component.proposedName = 'General';
    component.onPropose();

    mock.expectOne('http://localhost:3000/requests')
      .flush({ error: 'That group already has a channel with this name' },
             { status: 409, statusText: 'Conflict' });

    expect(component.formError()).toContain('already has a channel');
  });

  it('lists rooms that are proposed but not yet approved', async () => {
    await build('member@test.com');
    load(makeGroup({ _id: '' }), [makeRequest({ payload: { name: 'Spoilers' } })]);

    // shown as queued, not as a clickable room
    expect(component.proposals().length).toBe(1);
    expect(component.channels().length).toBe(1);
  });

  it('offers a non-member a join button instead of room links that would fail', async () => {
    await build('stranger@test.com');
    load();
    await fixture.whenStable();

    const page = fixture.nativeElement as HTMLElement;
    expect(page.querySelector('.join-bar button')?.textContent).toContain('Request to join');
    expect(page.querySelector('a.room-row')).toBeNull();
    expect(page.querySelector('.room-row.locked')?.textContent).toContain('Join to chat');
  });

  it('asks to join from the group page, and says an admin will review it', async () => {
    await build('stranger@test.com');
    load();

    component.onJoin();
    const req = mock.expectOne(r => r.method === 'POST' && r.url.endsWith('/requests'));
    expect(req.request.body).toEqual({ type: 'group-join', requestedBy: 'stranger@test.com', groupId: '', payload: {} });
    req.flush(makeRequest({ type: 'group-join', status: 'pending', groupId: '' }));

    expect(component.formSuccess()).toContain('An admin of the group will review it');
    expect(component.joining()).toBe(false);
  });

  it('shows the reason when the request is rejected straight away for being too young', async () => {
    await build('stranger@test.com');
    load();

    component.onJoin();
    mock.expectOne(r => r.method === 'POST' && r.url.endsWith('/requests'))
      .flush(makeRequest({ type: 'group-join', status: 'rejected', reason: 'You must be at least 18 to join this group.' }));

    expect(component.formError()).toContain('at least 18');
    expect(component.joining()).toBe(false);
  });

  it('says the request is waiting instead of offering the button again', async () => {
    await build('stranger@test.com');
    load(makeGroup({ _id: '' }), [], [makeRequest({ type: 'group-join', requestedBy: 'stranger@test.com' })]);
    await fixture.whenStable();

    const bar = (fixture.nativeElement as HTMLElement).querySelector('.join-bar')!;
    expect(bar.textContent).toContain('asked to join');
    expect(bar.querySelector('button')).toBeNull();
  });

  it('gives the super admin no join button, since they can\'t be a member', async () => {
    await build('boss@test.com', 'super');
    load();
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).querySelector('.join-bar')).toBeNull();
    expect((fixture.nativeElement as HTMLElement).querySelector('.room-row.locked')?.textContent).toContain('Members only');
  });
});
