import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { GroupView } from './group-view';
import { testProviders, signIn, signOut, makeGroup, makeChannel, makeRequest, flushByUrl } from '../testing';

describe('GroupView', () => {
  let component: GroupView;
  let fixture: ComponentFixture<GroupView>;
  let mock: HttpTestingController;

  async function build(email: string) {
    signIn(email);
    fixture = TestBed.createComponent(GroupView);
    component = fixture.componentInstance;
    mock = TestBed.inject(HttpTestingController);
    await fixture.whenStable();
  }

  // the test router has no :id, so the component looks for a group whose id is ''
  function load(group = makeGroup({ id: '' }), proposals: any[] = []) {
    flushByUrl(mock, { '/groups': [group], '/channels': [makeChannel()], '/requests': proposals });
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

    // the same check the route guard on the admin page makes: is my email in this group's
    // adminEmails
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

    // every group is visible to everyone, so a non-member can open this page — they just
    // can't propose a room in it
    expect(component.isMember()).toBe(false);
  });

  it('proposes a room rather than creating one', async () => {
    await build('member@test.com');
    load();

    component.proposedName = 'Spoilers';
    component.onPropose();

    // the spec says a regular user proposes a room and the group admin approves or rejects it
    const req = mock.expectOne('http://localhost:3000/requests');
    expect(req.request.body.type).toBe('channel-create');
    expect(req.request.body.payload.name).toBe('Spoilers');
    req.flush(makeRequest());

    load();   // the page reloads after a successful proposal
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
    load(makeGroup({ id: '' }), [makeRequest({ payload: { name: 'Spoilers' } })]);

    // shown so a member can see their proposal is queued rather than lost, but not as a
    // clickable room — the channel doesn't exist yet
    expect(component.proposals().length).toBe(1);
    expect(component.channels().length).toBe(1);
  });
});
