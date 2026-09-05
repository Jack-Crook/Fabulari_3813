import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { UserDashboard } from './user-dashboard';
import { testProviders, signIn, signOut, makeGroup, makeRequest, flushByUrl } from '../testing';

describe('UserDashboard', () => {
  let component: UserDashboard;
  let fixture: ComponentFixture<UserDashboard>;
  let mock: HttpTestingController;

  const groups = [
    makeGroup({ id: 'g1', name: 'Book Club', memberEmails: ['admin@test.com', 'member@test.com'] }),
    makeGroup({ id: 'g2', name: 'Robotics', ageLimit: 16, memberEmails: ['admin@test.com'] }),
  ];

  // the component reads the signed in user in a field initialiser and fetches in its
  // constructor, so signing in has to happen before it's built
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

    // one call fills both panels — the difference is only whether this email is in the
    // group's member list
    expect(component.myGroups().map(g => g.id)).toEqual(['g1']);
    expect(component.discover().map(g => g.id)).toEqual(['g2']);
  });

  it('shows the super admin every group and nothing to discover', async () => {
    await build('boss@test.com', 'super');
    flushByUrl(mock, { '/groups': groups });

    // the super admin can't be a member of any group, so the member split doesn't apply —
    // they oversee all of them instead
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

    // the spec says group creation goes to the super admin, and that the requester supplies
    // the details up front — so this posts a request, not a group
    const req = mock.expectOne('http://localhost:3000/requests');
    expect(req.request.body.type).toBe('group-create');
    expect(req.request.body.payload.name).toBe('Chess Club');
    req.flush(makeRequest({ type: 'group-create' }));

    expect(component.formSuccess()).toContain('first admin');
  });

  it('surfaces the auto rejection when the user is under the age limit', async () => {
    await build('member@test.com');
    flushByUrl(mock, { '/groups': groups, '/requests': [] });

    component.onJoin(groups[1]);

    // every group is visible whatever your age; the check happens when you try to join, and
    // the server answers 403 with the reason
    mock.expectOne('http://localhost:3000/groups/g2/members')
      .flush({ error: 'You must be at least 16 to join this group.' },
             { status: 403, statusText: 'Forbidden' });

    expect(component.formError()).toContain('at least 16');
  });

  it('surfaces the 409 when the last admin tries to leave', async () => {
    await build('admin@test.com');
    flushByUrl(mock, { '/groups': groups, '/requests': [] });

    component.onLeave(groups[0]);

    // a group must always keep at least one admin, so leaving is refused. disbanding goes
    // through a deletion request to the super admin instead.
    mock.expectOne(r => r.url.includes('/groups/g1/members/'))
      .flush({ error: 'Cannot remove the only admin of this group' },
             { status: 409, statusText: 'Conflict' });

    expect(component.formError()).toContain('only admin');
  });
});
