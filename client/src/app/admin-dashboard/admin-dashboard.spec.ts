import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { AdminDashboard } from './admin-dashboard';
import { testProviders, signIn, signOut, makeGroup, makeChannel, makeRequest, flushByUrl } from '../testing';

describe('AdminDashboard', () => {
  let component: AdminDashboard;
  let fixture: ComponentFixture<AdminDashboard>;
  let mock: HttpTestingController;

  async function build(email = 'admin@test.com') {
    signIn(email);
    fixture = TestBed.createComponent(AdminDashboard);
    component = fixture.componentInstance;
    mock = TestBed.inject(HttpTestingController);
    await fixture.whenStable();
  }

  // the route has no :groupId in the test router, so paramMap gives '' and the component
  // fetches with an empty id. what matters here is the behaviour once the data arrives.
  function load(group = makeGroup(), proposals = [makeRequest()]) {
    flushByUrl(mock, { '/groups': [group], '/channels': [makeChannel()], '/requests': proposals });
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AdminDashboard],
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

  it('reads a member\'s role off the group rather than the user record', async () => {
    await build();
    load(makeGroup({ id: '', adminEmails: ['admin@test.com'], memberEmails: ['admin@test.com', 'member@test.com'] }));

    // there is no per-member role stored anywhere — an admin is just an email that appears in
    // the group's adminEmails
    expect(component.roleOf('admin@test.com')).toBe('Admin');
    expect(component.roleOf('member@test.com')).toBe('Member');
  });

  it('flags the last remaining admin so they can\'t be demoted or removed', async () => {
    await build();
    load(makeGroup({ id: '', adminEmails: ['admin@test.com'] }));

    // a group must always keep at least one admin. the server returns 409 either way, this
    // just disables the buttons first.
    expect(component.isLastAdmin('admin@test.com')).toBe(true);
    expect(component.isLastAdmin('member@test.com')).toBe(false);
  });

  it('stops flagging once a second admin exists', async () => {
    await build();
    load(makeGroup({ id: '', adminEmails: ['admin@test.com', 'member@test.com'] }));

    expect(component.isLastAdmin('admin@test.com')).toBe(false);
  });

  it('sends the actor with a settings change', async () => {
    await build();
    load(makeGroup({ id: '' }));

    component.formName = 'Renamed';
    component.formAgeLimit = 18;
    component.onSaveSettings();

    // no request needed to edit a group — the spec only sends creation and deletion to the
    // super admin. the server still checks the caller really is an admin here.
    const req = mock.expectOne(r => r.method === 'PATCH');
    expect(req.request.body.actorEmail).toBe('admin@test.com');
    req.flush({ group: makeGroup(), booted: [] });
  });

  it('reports who was removed when the age limit is raised', async () => {
    await build();
    load(makeGroup({ id: '' }));

    component.onSaveSettings();
    mock.expectOne(r => r.method === 'PATCH')
      .flush({ group: makeGroup({ ageLimit: 18 }), booted: ['kid@test.com'] });

    // raising the limit automatically removes members who no longer meet it, so the admin is
    // told rather than finding out later
    expect(component.actionSuccess()).toContain('kid@test.com');
  });

  it('raises a deletion request instead of deleting the group', async () => {
    await build();
    load(makeGroup({ id: '' }));

    component.onRequestDeletion();

    // a group admin can't delete their own group. this is also how a group with no working
    // admin gets disbanded.
    const req = mock.expectOne('http://localhost:3000/requests');
    expect(req.request.body.type).toBe('group-delete');
    req.flush(makeRequest({ type: 'group-delete' }));
    expect(component.actionSuccess()).toContain('super admin');
  });

  it('reports a user for a permanent ban rather than banning them', async () => {
    await build();
    load(makeGroup({ id: '' }));

    component.banReason = 'harassment';
    component.onReportUser('bad@test.com');

    // only the super admin can ban system wide, and only from a group admin's report — an
    // admin can't ban directly without a prior report
    const req = mock.expectOne('http://localhost:3000/requests');
    expect(req.request.body.type).toBe('user-ban');
    expect(req.request.body.payload).toEqual({ email: 'bad@test.com', reason: 'harassment' });
    req.flush(makeRequest({ type: 'user-ban' }));
  });

  it('bans from the group directly, because that one needs no request', async () => {
    await build();
    load(makeGroup({ id: '' }));

    component.banReason = 'spam';
    component.onBanFromGroup('bad@test.com');

    // a group level ban is the admin's own call — the account still exists and keeps its
    // other groups, and this ban can be lifted later
    const req = mock.expectOne(r => r.url.includes('/bans') && r.method === 'POST');
    expect(req.request.body.reason).toBe('spam');
    req.flush(makeGroup());
  });

  it('surfaces the 403 when trying to approve your own proposal', async () => {
    await build();
    const mine = makeRequest({ requestedBy: 'admin@test.com' });
    load(makeGroup({ id: '' }), [mine]);

    component.onApproveProposal(mine);
    mock.expectOne(r => r.url.includes('/approve'))
      .flush({ error: 'You cannot approve your own request' }, { status: 403, statusText: 'Forbidden' });

    expect(component.actionError()).toContain('your own request');
  });

  it('sends the reason with a rejection', async () => {
    await build();
    const proposal = makeRequest();
    load(makeGroup({ id: '' }), [proposal]);

    component.rejectReason = 'We already have a room for that';
    component.onRejectProposal(proposal);

    // the spec requires a reason on every rejection, and the requester reads it back on their
    // own profile page
    const req = mock.expectOne(r => r.url.includes('/reject'));
    expect(req.request.body.reason).toBe('We already have a room for that');
    req.flush(makeRequest({ status: 'rejected' }));
  });
});
