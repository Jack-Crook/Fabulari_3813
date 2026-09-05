import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { SuperAdminDashboard } from './super-admin-dashboard';
import { testProviders, signIn, signOut, makeGroup, makeUser, makeRequest, flushByUrl } from '../testing';

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
    // /audit/types has to be answered before /audit, because the shorter url matches both
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

    // scope: 'super' is the three system level types. room proposals go to the group's own
    // admin, so they're deliberately not in this queue.
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

    // group admin is held on the group rather than the account, so it can only be counted by
    // looking through the groups
    expect(component.groupCountFor('admin@test.com')).toBe(1);
    expect(component.adminCountFor('admin@test.com')).toBe(1);
    expect(component.adminCountFor('member@test.com')).toBe(0);
  });

  it('refetches the log when the type filter changes', async () => {
    await build();
    load();

    component.onFilterAudit('User Banned');

    // the spec asks for a log filterable by type in date order, and both happen on the server
    // — so changing the filter refetches rather than hiding rows already on the page
    const req = mock.expectOne(r => r.url === 'http://localhost:3000/audit');
    expect(req.request.params.get('type')).toBe('User Banned');
    req.flush([]);
  });

  it('approves a request as the super admin', async () => {
    await build();
    const request = makeRequest({ type: 'group-create', summary: 'Create group "Chess Club"' });
    load([request]);

    component.onApprove(request);

    // approving is what actually carries the request out — the group is created on the
    // server, with the requester as its first admin
    const req = mock.expectOne('http://localhost:3000/requests/r1/approve');
    expect(req.request.body.actorEmail).toBe('boss@test.com');
    req.flush(makeRequest({ status: 'approved' }));
    expect(component.actionSuccess()).toContain('Chess Club');

    load([]);   // the page reloads all five panels after an action
  });

  it('surfaces the 400 when a rejection has no reason', async () => {
    await build();
    const request = makeRequest();
    load([request]);

    component.rejectReason = '';
    component.onReject(request);

    mock.expectOne('http://localhost:3000/requests/r1/reject')
      .flush({ error: 'A reason is required when rejecting a request' },
             { status: 400, statusText: 'Bad Request' });

    expect(component.actionError()).toContain('reason is required');
  });

  it('labels the three request types it can action', async () => {
    await build();
    load();

    expect(component.labelFor('group-create')).toBe('New group');
    expect(component.labelFor('group-delete')).toBe('Delete group');
    expect(component.labelFor('user-ban')).toBe('Permanent ban');
  });
});
