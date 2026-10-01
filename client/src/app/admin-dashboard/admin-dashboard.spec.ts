import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { Router } from '@angular/router';

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

  // the test router has no :groupId, so the id is ''. what matters is the behaviour after the data arrives.
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
    load(makeGroup({ _id: '', adminEmails: ['admin@test.com'], memberEmails: ['admin@test.com', 'member@test.com'] }));

    // an admin is an email in adminEmails, there's no per-member role
    expect(component.roleOf('admin@test.com')).toBe('Admin');
    expect(component.roleOf('member@test.com')).toBe('Member');
  });

  it('flags the last remaining admin so they can\'t be demoted or removed', async () => {
    await build();
    load(makeGroup({ _id: '', adminEmails: ['admin@test.com'] }));

    // the server answers 409, this just disables the buttons first
    expect(component.isLastAdmin('admin@test.com')).toBe(true);
    expect(component.isLastAdmin('member@test.com')).toBe(false);
  });

  it('stops flagging once a second admin exists', async () => {
    await build();
    load(makeGroup({ _id: '', adminEmails: ['admin@test.com', 'member@test.com'] }));

    expect(component.isLastAdmin('admin@test.com')).toBe(false);
  });

  it('sends the actor with a settings change', async () => {
    await build();
    load(makeGroup({ _id: '' }));

    component.formName = 'Renamed';
    component.formAgeLimit = 18;
    component.onSaveSettings();

    // no request needed to edit. the server still checks the caller is an admin.
    const req = mock.expectOne(r => r.method === 'PATCH');
    expect(req.request.body.actorEmail).toBe('admin@test.com');
    req.flush({ group: makeGroup(), booted: [] });
  });

  it('reports who was removed when the age limit is raised', async () => {
    await build();
    load(makeGroup({ _id: '' }));

    component.onSaveSettings();
    mock.expectOne(r => r.method === 'PATCH')
      .flush({ group: makeGroup({ ageLimit: 18 }), booted: ['kid@test.com'] });

    // raising the limit removes under-age members, and the admin is told
    expect(component.actionSuccess()).toContain('kid@test.com');
  });

  it('raises a deletion request instead of deleting the group', async () => {
    await build();
    load(makeGroup({ _id: '' }));

    component.onRequestDeletion();

    // an admin can't delete their own group, they ask the super admin
    const req = mock.expectOne('http://localhost:3000/requests');
    expect(req.request.body.type).toBe('group-delete');
    req.flush(makeRequest({ type: 'group-delete' }));
    expect(component.actionSuccess()).toContain('super admin');
  });

  it('reports a user for a permanent ban rather than banning them', async () => {
    await build();
    load(makeGroup({ _id: '' }));

    component.banReason = 'harassment';
    component.onReportUser('bad@test.com');

    // system bans need a report to the super admin
    const req = mock.expectOne('http://localhost:3000/requests');
    expect(req.request.body.type).toBe('user-ban');
    expect(req.request.body.payload).toEqual({ email: 'bad@test.com', reason: 'harassment' });
    req.flush(makeRequest({ type: 'user-ban' }));
  });

  it('bans from the group directly, because that one needs no request', async () => {
    await build();
    load(makeGroup({ _id: '' }));

    component.banReason = 'spam';
    component.onBanFromGroup('bad@test.com');

    // a group ban is the admin's call, and can be lifted
    const req = mock.expectOne(r => r.url.includes('/bans') && r.method === 'POST');
    expect(req.request.body.reason).toBe('spam');
    req.flush(makeGroup());
  });

  it('surfaces the 403 when trying to approve your own proposal', async () => {
    await build();
    const mine = makeRequest({ requestedBy: 'admin@test.com' });
    load(makeGroup({ _id: '' }), [mine]);

    component.onApproveProposal(mine);
    mock.expectOne(r => r.url.includes('/approve'))
      .flush({ error: 'You cannot approve your own request' }, { status: 403, statusText: 'Forbidden' });

    expect(component.actionError()).toContain('your own request');
  });

  it('sends the reason with a rejection', async () => {
    await build();
    const proposal = makeRequest();
    load(makeGroup({ _id: '' }), [proposal]);

    component.rejectReason = 'We already have a room for that';
    component.onRejectProposal(proposal);

    // a rejection needs a reason
    const req = mock.expectOne(r => r.url.includes('/reject'));
    expect(req.request.body.reason).toBe('We already have a room for that');
    req.flush(makeRequest({ status: 'rejected' }));
  });

  it('asks before deleting a room, and only deletes once confirmed', async () => {
    await build();
    load();
    await fixture.whenStable();
    const page = fixture.nativeElement as HTMLElement;

    // the first click only opens the confirm box
    const deleteButton = [...page.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Delete')!;
    deleteButton.click();
    await fixture.whenStable();
    mock.expectNone(r => r.method === 'DELETE');
    expect(page.querySelector('.confirm-text')?.textContent).toContain('every message');
    // focus goes to Cancel, so Enter backs out
    expect(document.activeElement?.textContent?.trim()).toBe('Cancel');

    component.onDeleteRoom(makeChannel());
    mock.expectOne(r => r.method === 'DELETE' && r.url.includes('/channels/c1')).flush({ message: 'ok' });
    expect(component.confirmingDeleteId()).toBe('');
  });

  it('cancelling the confirm box sends nothing', async () => {
    await build();
    load();

    component.startDeleting(makeChannel());
    component.confirmingDeleteId.set('');        // what Cancel does
    component.startRemoving('member@test.com');
    component.confirmingRemoveEmail.set('');
    mock.expectNone(r => r.method === 'DELETE');
  });

  it('goes back to the group page after stepping down, since the admin controls would all fail now', async () => {
    await build();
    load(makeGroup({ _id: '', adminEmails: ['admin@test.com', 'member@test.com'] }));
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    component.onDemote('admin@test.com');
    mock.expectOne(r => r.method === 'DELETE' && r.url.includes('/admins/')).flush(makeGroup());

    expect(navigate).toHaveBeenCalledWith(['/groups', '']);
  });

  it('goes to the dashboard after leaving the group from this page', async () => {
    await build();
    load(makeGroup({ _id: '', adminEmails: ['admin@test.com', 'member@test.com'] }));
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    component.onRemoveMember('admin@test.com');
    mock.expectOne(r => r.method === 'DELETE' && r.url.includes('/members/')).flush(makeGroup());

    expect(navigate).toHaveBeenCalledWith(['/user-dashboard']);
  });

  it('stays on the page after demoting someone else', async () => {
    await build();
    load(makeGroup({ _id: '', adminEmails: ['admin@test.com', 'member@test.com'] }));
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    component.onDemote('member@test.com');
    mock.expectOne(r => r.method === 'DELETE' && r.url.includes('/admins/')).flush(makeGroup());

    expect(navigate).not.toHaveBeenCalled();
    expect(component.actionSuccess()).toContain('member@test.com');
  });

  it('links back to the group\'s own page', async () => {
    await build();
    load();

    const back = (fixture.nativeElement as HTMLElement).querySelector('a.page-back');
    expect(back?.textContent).toContain('Back to group');
    expect(back?.getAttribute('href')).toMatch(/^\/groups/);     // the test router's group id is ''
  });

  it('asks before removing a member, with one box open under a member at a time', async () => {
    await build();
    load();

    component.startBanning('member@test.com');
    component.startRemoving('member@test.com');
    expect(component.banningEmail()).toBe('');     // opening one closes the other
    expect(component.confirmingRemoveEmail()).toBe('member@test.com');
    mock.expectNone(r => r.method === 'DELETE');
  });
});
