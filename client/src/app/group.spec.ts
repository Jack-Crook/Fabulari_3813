import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { GroupService } from './group';
import { testProviders, makeGroup } from './testing';

describe('GroupService', () => {
  let service: GroupService;
  let mock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: testProviders() });
    service = TestBed.inject(GroupService);
    mock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => mock.verify());

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('asks for one group\'s channels with a query parameter', () => {
    service.getChannels('g1').subscribe();

    const req = mock.expectOne(r => r.url === 'http://localhost:3000/channels');
    // /channels lists them all, /channels?groupId=g1 lists just one group's
    expect(req.request.params.get('groupId')).toBe('g1');
    req.flush([]);
  });

  it('sends the actor with a group edit so the server can check they are an admin', () => {
    service.updateGroup('g1', { name: 'Renamed', ageLimit: 18 }, 'admin@test.com').subscribe();

    const req = mock.expectOne('http://localhost:3000/groups/g1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body.actorEmail).toBe('admin@test.com');
    req.flush({ group: makeGroup(), booted: [] });
  });

  it('url encodes the email when removing a member', () => {
    service.removeMember('g1', 'a+b@test.com', 'admin@test.com').subscribe();

    // the email is in the path rather than the body, and + and # would otherwise change what
    // the path means
    const req = mock.expectOne(r => r.url === 'http://localhost:3000/groups/g1/members/a%2Bb%40test.com');
    expect(req.request.method).toBe('DELETE');
    req.flush(makeGroup());
  });

  it('promotes with a POST and demotes with a DELETE on the same admins path', () => {
    service.promoteAdmin('g1', 'member@test.com', 'admin@test.com').subscribe();
    const promote = mock.expectOne('http://localhost:3000/groups/g1/admins');
    expect(promote.request.method).toBe('POST');
    promote.flush(makeGroup());

    service.demoteAdmin('g1', 'member@test.com', 'admin@test.com').subscribe();
    const demote = mock.expectOne(r => r.url === 'http://localhost:3000/groups/g1/admins/member%40test.com');
    expect(demote.request.method).toBe('DELETE');
    demote.flush(makeGroup());
  });

  it('sends a reason with a group level ban', () => {
    service.banFromGroup('g1', 'bad@test.com', 'spam', 'admin@test.com').subscribe();

    const req = mock.expectOne('http://localhost:3000/groups/g1/bans');
    expect(req.request.body).toEqual({ email: 'bad@test.com', reason: 'spam', actorEmail: 'admin@test.com' });
    req.flush(makeGroup());
  });
});
