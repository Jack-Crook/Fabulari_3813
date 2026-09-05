import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { Auth } from './auth';
import { testProviders, signIn, signOut } from './testing';

describe('Auth', () => {
  let service: Auth;
  let mock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: testProviders() });
    service = TestBed.inject(Auth);
    mock = TestBed.inject(HttpTestingController);
    signOut();      // each test starts with nobody signed in
  });

  afterEach(() => {
    mock.verify();  // fails the test if a request was made that no expectation answered
    signOut();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('posts the register form to /register', () => {
    service.register('New@Test.com ', 'pw1234', 'Newbie', '2000-01-01').subscribe();

    const req = mock.expectOne('http://localhost:3000/register');
    expect(req.request.method).toBe('POST');
    // the email is sent as typed. normalising it is the server's job, so that one rule lives
    // in one place rather than being half enforced on each side.
    expect(req.request.body).toEqual({
      email: 'New@Test.com ', password: 'pw1234', username: 'Newbie', dob: '2000-01-01',
    });
    req.flush({ message: 'ok', email: 'new@test.com', role: 'user' });
  });

  it('posts credentials to /login', () => {
    service.login('a@b.com', 'pw1234').subscribe();

    const req = mock.expectOne('http://localhost:3000/login');
    expect(req.request.method).toBe('POST');
    req.flush({ message: 'ok', email: 'a@b.com', role: 'user', username: 'a', dob: '', bio: '', createdAt: '' });
  });

  it('url encodes the email when fetching one user', () => {
    service.fetchUser('a+b@test.com').subscribe();

    // + means a space in a url, so an unencoded email would ask for the wrong account
    const req = mock.expectOne('http://localhost:3000/users/a%2Bb%40test.com');
    expect(req.request.method).toBe('GET');
    req.flush({});
  });

  it('never sends the email or the role when updating a profile', () => {
    service.updateProfile('a@b.com', { username: 'New Name', bio: 'hi' }).subscribe();

    const req = mock.expectOne('http://localhost:3000/users/a%40b.com');
    expect(req.request.method).toBe('PUT');
    // email identifies the account and role is what makes someone the super admin, so neither
    // is editable from here
    expect(req.request.body.email).toBeUndefined();
    expect(req.request.body.role).toBeUndefined();
    req.flush({});
  });

  it('round trips the signed in user through localStorage', () => {
    service.saveUser({ email: 'a@b.com', role: 'user', username: 'a' });

    expect(service.getUser()).toEqual({ email: 'a@b.com', role: 'user', username: 'a' });
    expect(service.email).toBe('a@b.com');
  });

  it('reports null and an empty email when nobody is signed in', () => {
    expect(service.getUser()).toBeNull();
    expect(service.email).toBe('');
    expect(service.isSuper).toBe(false);
  });

  it('recognises the super admin by role', () => {
    signIn('boss@test.com', 'super');
    expect(service.isSuper).toBe(true);
  });

  it('clears the stored user on logout', () => {
    signIn('a@b.com');
    service.logout();
    expect(service.getUser()).toBeNull();
  });
});
