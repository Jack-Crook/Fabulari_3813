import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { SuperAdminDashboard } from './super-admin-dashboard';
import { testProviders, signIn, signOut, makeGroup, makeUser, makeRequest, flushByUrl, liveUpdates } from '../testing';

describe('SuperAdminDashboard', () => {
  let component: SuperAdminDashboard;
  let fixture: ComponentFixture<SuperAdminDashboard>;
  let mock: HttpTestingController;

  async function build() {
    signIn('boss@test.com', 'super');
    fixture = TestBed.createComponent(SuperAdminDashboard);
    component = fixture.componentInstance;
    mock = TestBed.inject(HttpTestingController);
    await fixture.whenStable();
  }

  function load(requests = [makeRequest({ type: 'group-create' })]) {
    // answer /audit/types first, the shorter /audit matches both
    flushByUrl(mock, {
      '/requests': requests,
      '/users': [makeUser({ email: 'admin@test.com' }), makeUser()],
      '/groups': [makeGroup()],
      '/bans': [],
      '/audit/types': ['Group Created'],
      '/audit': [],
    });
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SuperAdminDashboard],
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

  it('asks only for the requests the super admin actions', async () => {
    await build();

    // only the super admin's types, room proposals go to group admins
    const req = mock.expectOne(r => r.url === 'http://localhost:3000/requests');
    expect(req.request.params.get('scope')).toBe('super');
    expect(req.request.params.get('status')).toBe('pending');
    req.flush([]);

    flushByUrl(mock, {
      '/users': [], '/groups': [], '/bans': [], '/audit/types': [], '/audit': [],
    });
  });

  it('counts a user\'s groups and the ones they admin separately', async () => {
    await build();
    load();

    // group admin is stored on groups, so it's counted from them
    expect(component.groupCountFor('admin@test.com')).toBe(1);
    expect(component.adminCountFor('admin@test.com')).toBe(1);
    expect(component.adminCountFor('member@test.com')).toBe(0);
  });

  it('refetches the log when the type filter changes', async () => {
    await build();
    load();

    component.onFilterAudit('User Banned');

    // filtering is on the server, so changing it refetches
    const req = mock.expectOne(r => r.url === 'http://localhost:3000/audit');
    expect(req.request.params.get('type')).toBe('User Banned');
    req.flush([]);
  });

  it('approves a request as the super admin', async () => {
    await build();
    const request = makeRequest({ type: 'group-create', summary: 'Create group "Chess Club"' });
    load([request]);

    component.onApprove(request);

    // approving carries the request out on the server
    const req = mock.expectOne('http://localhost:3000/requests/r1/approve');
    expect(req.request.body.actorEmail).toBe('boss@test.com');
    req.flush(makeRequest({ status: 'approved' }));
    expect(component.actionSuccess()).toContain('Chess Club');

    load([]);   // everything reloads after an action
  });

  it('asks for a reason before rejecting, without sending anything', async () => {
    await build();
    const request = makeRequest();
    load([request]);

    component.rejectReason = '  ';
    component.onReject(request);

    mock.expectNone('http://localhost:3000/requests/r1/reject');
    expect(component.actionError()).toContain('reason is required');
  });

  it('labels the three request types it can action', async () => {
    await build();
    load();

    expect(component.labelFor('group-create')).toBe('New group');
    expect(component.labelFor('group-delete')).toBe('Delete group');
    expect(component.labelFor('user-ban')).toBe('Permanent ban');
  });

  it('asks before approving a permanent ban, and says what it will do', async () => {
    await build();
    const request = makeRequest({
      _id: 'r9', type: 'user-ban', summary: 'Permanently ban bob@test.com',
      payload: { email: 'bob@test.com', reason: 'spam' }, groupId: 'g1',
    });
    load([request]);

    component.onApproveClicked(request);
    await fixture.whenStable();
    mock.expectNone(r => r.url.includes('/approve'));
    expect((fixture.nativeElement as HTMLElement).querySelector('.confirm-text')?.textContent)
      .toContain('can never register again');

    component.onApprove(request);      // "Yes, approve"
    mock.expectOne('http://localhost:3000/requests/r9/approve').flush(makeRequest({ status: 'approved' }));
    expect(component.confirmingId()).toBe('');
    load([]);
  });

  it('approves a new group straight away, because nothing is lost by it', async () => {
    await build();
    const request = makeRequest({ type: 'group-create', summary: 'Create group "Chess Club"' });
    load([request]);

    component.onApproveClicked(request);
    expect(component.confirmingId()).toBe('');
    mock.expectOne('http://localhost:3000/requests/r1/approve').flush(makeRequest({ status: 'approved' }));
    load([]);
  });

  it('shows the audit log a page at a time, and fetches the next page on request', async () => {
    await build();
    const page = Array.from({ length: 100 }, (_, i) => ({ _id: `a${i}`, at: '', type: 'Test', actor: 'x', detail: '' }));
    flushByUrl(mock, {
      '/requests': [], '/users': [], '/groups': [], '/bans': [], '/audit/types': [], '/audit': page,
    });
    // a full page came back, so there may be more
    expect(component.moreAudit()).toBe(true);

    component.onShowOlderAudit();
    const next = mock.expectOne(r => r.url.endsWith('/audit') && r.params.get('skip') === '100');
    next.flush([{ _id: 'old', at: '', type: 'Test', actor: 'x', detail: '' }]);

    expect(component.auditLog().length).toBe(101);
    expect(component.moreAudit()).toBe(false);
  });

  it('refreshes the queue when the server announces a change to the requests', async () => {
    await build();
    load();

    liveUpdates.announce?.(null);
    // the queue is fetched again
    expect(mock.match(r => r.url.endsWith('/requests')).length).toBe(1);
  });
});
