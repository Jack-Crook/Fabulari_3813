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
    mock.verify();  // fails if a request went unanswered
    signOut();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('posts the register form to /register', () => {
    service.register('New@Test.com ', 'pw1234', 'Newbie', '2000-01-01').subscribe();

    const req = mock.expectOne('http://localhost:3000/register');
    expect(req.request.method).toBe('POST');
    // sent as typed, the server normalises it
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

    // + means a space in a url, so it must be encoded
    const req = mock.expectOne('http://localhost:3000/users/a%2Bb%40test.com');
    expect(req.request.method).toBe('GET');
    req.flush({});
  });

  it('never sends the email or the role when updating a profile', () => {
    service.updateProfile('a@b.com', { username: 'New Name', bio: 'hi' }).subscribe();

    const req = mock.expectOne('http://localhost:3000/users/a%40b.com');
    expect(req.request.method).toBe('PUT');
    // email and role aren't editable
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

  it('uploads a profile picture as a form with actorEmail before the file', () => {
    signIn('a+b@test.com');
    service.uploadAvatar(new File(['x'], 'me.png', { type: 'image/png' })).subscribe();

    const req = mock.expectOne('http://localhost:3000/users/a%2Bb%40test.com/avatar');
    expect(req.request.method).toBe('POST');
    // multer reads the form in order, so actorEmail comes before the file
    const fields = [...(req.request.body as FormData).keys()];
    expect(fields).toEqual(['actorEmail', 'image']);
    req.flush({});
  });

  it('removes the profile picture with actorEmail in the query', () => {
    signIn('a@b.com');
    service.removeAvatar().subscribe();

    const req = mock.expectOne(r => r.url === 'http://localhost:3000/users/a%40b.com/avatar');
    expect(req.request.method).toBe('DELETE');
    expect(req.request.params.get('actorEmail')).toBe('a@b.com');
    req.flush({});
  });

  it('updates the session signal when the stored user changes', () => {
    service.saveUser({ email: 'a@b.com', role: 'user', username: 'a' });
    expect(service.session()?.username).toBe('a');

    // lets the navbar redraw after a profile change
    service.saveUser({ email: 'a@b.com', role: 'user', username: 'renamed', avatarUrl: '/uploads/x.png' });
    expect(service.session()?.username).toBe('renamed');
    expect(service.session()?.avatarUrl).toBe('/uploads/x.png');

    service.logout();
    expect(service.session()).toBeNull();
  });
});
