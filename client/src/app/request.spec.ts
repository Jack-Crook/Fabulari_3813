import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { RequestService } from './request';
import { testProviders, makeRequest } from './testing';

describe('RequestService', () => {
  let service: RequestService;
  let mock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: testProviders() });
    service = TestBed.inject(RequestService);
    mock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => mock.verify());

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('drops empty filters instead of sending them as the string "undefined"', () => {
    service.getRequests({ status: 'pending', scope: 'super', type: '' }).subscribe();

    const req = mock.expectOne(r => r.url === 'http://localhost:3000/requests');
    expect(req.request.params.get('status')).toBe('pending');
    expect(req.request.params.get('scope')).toBe('super');
    expect(req.request.params.has('type')).toBe(false);
    req.flush([]);
  });

  it('raises a request with its type, requester and payload', () => {
    service.raise('group-create', 'me@test.com', { name: 'Chess Club' }).subscribe();

    const req = mock.expectOne('http://localhost:3000/requests');
    expect(req.request.method).toBe('POST');
    // the spec says the requesting user supplies the group's details up front, so they travel
    // in the payload rather than being filled in by the super admin after approval
    expect(req.request.body).toEqual({
      type: 'group-create', requestedBy: 'me@test.com', groupId: '', payload: { name: 'Chess Club' },
    });
    req.flush(makeRequest());
  });

  it('sends the reason when rejecting', () => {
    service.reject('r1', 'boss@test.com', 'Too similar to an existing group').subscribe();

    const req = mock.expectOne('http://localhost:3000/requests/r1/reject');
    // the spec requires a reason on every rejection, and the server answers 400 without one
    expect(req.request.body.reason).toBe('Too similar to an existing group');
    req.flush(makeRequest({ status: 'rejected' }));
  });

  it('only sends a type on the audit call when one is chosen', () => {
    service.getAudit().subscribe();
    const all = mock.expectOne(r => r.url === 'http://localhost:3000/audit');
    expect(all.request.params.has('type')).toBe(false);
    all.flush([]);

    service.getAudit('User Banned').subscribe();
    const filtered = mock.expectOne(r => r.url === 'http://localhost:3000/audit');
    expect(filtered.request.params.get('type')).toBe('User Banned');
    filtered.flush([]);
  });
});
