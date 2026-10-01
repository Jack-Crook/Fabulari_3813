import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { UserDashboard } from './user-dashboard';
import { testProviders, signIn, signOut, makeGroup, makeRequest, flushByUrl, liveUpdates } from '../testing';

describe('UserDashboard', () => {
  let component: UserDashboard;
  let fixture: ComponentFixture<UserDashboard>;
  let mock: HttpTestingController;

  const groups = [
    makeGroup({ _id: 'g1', name: 'Book Club', memberEmails: ['admin@test.com', 'member@test.com'] }),
    makeGroup({ _id: 'g2', name: 'Robotics', ageLimit: 16, memberEmails: ['admin@test.com'] }),
  ];

  // sign in before the component is built, it reads the user straight away
  async function build(email: string, role = 'user') {
    signIn(email, role);
    fixture = TestBed.createComponent(UserDashboard);
    component = fixture.componentInstance;
    mock = TestBed.inject(HttpTestingController);
    await fixture.whenStable();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UserDashboard],
      providers: testProviders(),
    }).compileComponents();
    signOut();
  });

  afterEach(() => signOut());

  it('should create', async () => {
    await build('member@test.com');
    flushByUrl(mock, { '/groups': groups, '/requests': [] });
    expect(component).toBeTruthy();
  });

  it('splits one /groups call into My Groups and Discover', async () => {
    await build('member@test.com');
    flushByUrl(mock, { '/groups': groups, '/requests': [] });

    // one call fills both panels, split on membership
    expect(component.myGroups().map(g => g._id)).toEqual(['g1']);
    expect(component.discover().map(g => g._id)).toEqual(['g2']);
  });

  it('shows the super admin every group and nothing to discover', async () => {
    await build('boss@test.com', 'super');
    flushByUrl(mock, { '/groups': groups });

    // the super admin is in no groups and sees them all
    expect(component.myGroups().length).toBe(2);
    expect(component.discover().length).toBe(0);
  });

  it('filters Discover as the search term changes', async () => {
    await build('member@test.com');
    flushByUrl(mock, { '/groups': groups, '/requests': [] });

    component.searchTerm.set('robot');
    expect(component.filteredDiscover().map(g => g.name)).toEqual(['Robotics']);

    component.searchTerm.set('nothing matches this');
    expect(component.filteredDiscover().length).toBe(0);
  });

  it('requests a group rather than creating one', async () => {
    await build('member@test.com');
    flushByUrl(mock, { '/groups': groups, '/requests': [] });

    component.newName = 'Chess Club';
    component.newAgeLimit = 0;
    component.onRequestGroup();

    // groups are requested from the super admin, not created
    const req = mock.expectOne('http://localhost:3000/requests');
    expect(req.request.body.type).toBe('group-create');
    expect(req.request.body.payload.name).toBe('Chess Club');
    req.flush(makeRequest({ type: 'group-create' }));

    expect(component.formSuccess()).toContain('first admin');
  });

  it('asks to join rather than joining, and says an admin will review it', async () => {
    await build('member@test.com');
    flushByUrl(mock, { '/groups': groups, '/requests': [] });

    component.onJoin(groups[1]);
    const req = mock.expectOne(r => r.method === 'POST' && r.url.endsWith('/requests'));
    expect(req.request.body).toEqual({ type: 'group-join', requestedBy: 'member@test.com', groupId: 'g2', payload: {} });
    req.flush(makeRequest({ type: 'group-join', status: 'pending', groupId: 'g2' }));

    expect(component.formSuccess()).toContain('An admin of the group will review it');
  });

  it('shows the reason when a request to join is rejected straight away for being too young', async () => {
    await build('member@test.com');
    flushByUrl(mock, { '/groups': groups, '/requests': [] });

    component.onJoin(groups[1]);

    // every group is visible, the age check happens when you ask to join
    mock.expectOne(r => r.method === 'POST' && r.url.endsWith('/requests'))
      .flush(makeRequest({ type: 'group-join', status: 'rejected', reason: 'You must be at least 16 to join this group.' }));

    expect(component.formError()).toContain('at least 16');
    expect(component.formSuccess()).toBe('');
  });

  it('knows which groups it has already asked to join', async () => {
    await build('member@test.com');
    flushByUrl(mock, { '/groups': groups, '/requests': [makeRequest({ type: 'group-join', groupId: 'g2' })] });

    expect(component.awaitingJoin(groups[1])).toBe(true);
    expect(component.awaitingJoin(groups[0])).toBe(false);
  });

  it('surfaces the 409 when the last admin tries to leave', async () => {
    await build('admin@test.com');
    flushByUrl(mock, { '/groups': groups, '/requests': [] });

    component.onLeave(groups[0]);

    // the last admin can't leave
    mock.expectOne(r => r.url.includes('/groups/g1/members/'))
      .flush({ error: 'Cannot remove the only admin of this group' },
             { status: 409, statusText: 'Conflict' });

    expect(component.formError()).toContain('only admin');
  });

  it('checks the group request before sending it', async () => {
    await build('member@test.com');
    flushByUrl(mock, { '/groups': groups, '/requests': [] });

    component.newName = '  ';
    component.onRequestGroup();
    expect(component.formError()).toBe('Group name is required');

    component.newName = 'Chess';
    component.newAgeLimit = 200;
    component.onRequestGroup();
    expect(component.formError()).toContain('Age limit');

    mock.expectNone(r => r.method === 'POST');
  });

  it('refreshes when the server announces a request change, e.g. my join was approved', async () => {
    await build('member@test.com');
    flushByUrl(mock, { '/groups': groups, '/requests': [] });

    liveUpdates.announce?.('g2');
    expect(mock.match(r => r.url.endsWith('/groups')).length).toBe(1);
  });
});
