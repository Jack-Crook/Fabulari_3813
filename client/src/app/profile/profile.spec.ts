import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { Profile } from './profile';
import { testProviders, signIn, signOut, makeGroup, makeUser, makeRequest, flushByUrl } from '../testing';

// the event a file input's (change) hands the component. size can be faked so the 5 MB test
// doesn't need a real 5 MB file.
function pick(type = 'image/png', size?: number) {
  const file = new File(['fake image bytes'], 'me', { type });
  if (size !== undefined) {
    Object.defineProperty(file, 'size', { value: size });
  }
  return { target: { files: [file], value: 'me' } } as unknown as Event;
}

describe('Profile', () => {
  let component: Profile;
  let fixture: ComponentFixture<Profile>;
  let mock: HttpTestingController;

  async function build(email = 'member@test.com') {
    signIn(email);
    fixture = TestBed.createComponent(Profile);
    component = fixture.componentInstance;
    mock = TestBed.inject(HttpTestingController);
    await fixture.whenStable();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Profile],
      providers: testProviders(),
    }).compileComponents();
    signOut();
  });

  afterEach(() => signOut());

  it('should create', async () => {
    await build();
    flushByUrl(mock, { '/users/': makeUser(), '/groups': [], '/requests': [] });
    expect(component).toBeTruthy();
  });

  it('reads the profile from the server rather than localStorage', async () => {
    await build();
    // localStorage only holds email, role and username, and goes stale the moment the profile
    // is edited, so the page fetches the stored record instead
    flushByUrl(mock, { '/users/': makeUser({ username: 'Stored Name', bio: 'from the server' }), '/groups': [], '/requests': [] });

    expect(component.user()?.username).toBe('Stored Name');
    expect(component.user()?.bio).toBe('from the server');
  });

  it('works out the age from the stored date of birth', async () => {
    await build();
    const bornTwentyYearsAgo = new Date();
    bornTwentyYearsAgo.setFullYear(bornTwentyYearsAgo.getFullYear() - 20);

    flushByUrl(mock, {
      '/users/': makeUser({ dob: bornTwentyYearsAgo.toISOString().slice(0, 10) }),
      '/groups': [], '/requests': [],
    });

    // age isn't stored, it's derived using the same calculation the server does when it checks a
    // group's age limit
    expect(component.age()).toBe(20);
  });

  it('splits the user\'s own requests into pending and rejected', async () => {
    await build();
    flushByUrl(mock, {
      '/users/': makeUser(), '/groups': [],
      '/requests': [
        makeRequest({ _id: 'r1', status: 'pending' }),
        makeRequest({ _id: 'r2', status: 'rejected', reason: 'Duplicate' }),
        makeRequest({ _id: 'r3', status: 'approved' }),
      ],
    });

    // the spec gives a user exactly two views of their own requests: what's pending, and what
    // was rejected and why. approved ones aren't listed.
    expect(component.pendingRequests().map(r => r._id)).toEqual(['r1']);
    expect(component.rejectedRequests().map(r => r._id)).toEqual(['r2']);
    expect(component.rejectedRequests()[0].reason).toBe('Duplicate');
  });

  it('lists the groups this user admins', async () => {
    await build('admin@test.com');
    flushByUrl(mock, {
      '/users/': makeUser({ email: 'admin@test.com' }),
      '/groups': [makeGroup({ _id: 'g1' }), makeGroup({ _id: 'g2', adminEmails: ['someone@else.com'], memberEmails: ['admin@test.com'] })],
      '/requests': [],
    });

    // group admin is a relationship with a group, not a role on the account, and this user is an
    // admin of one group and a plain member of the other
    expect(component.myGroups().length).toBe(2);
    expect(component.adminOf().map(g => g._id)).toEqual(['g1']);
  });

  it('does not send the password when the field is left blank', async () => {
    await build();
    flushByUrl(mock, { '/users/': makeUser(), '/groups': [], '/requests': [] });

    component.formUsername = 'New Name';
    component.formPassword = '';
    component.onSave();

    const req = mock.expectOne(r => r.method === 'PUT');
    // omitting it means "leave the password alone", because sending an empty one would blank it
    expect(req.request.body.password).toBeUndefined();
    expect(req.request.body.username).toBe('New Name');
    req.flush(makeUser({ username: 'New Name' }));
  });

  it('shows the server\'s message when the date of birth is invalid', async () => {
    await build();
    flushByUrl(mock, { '/users/': makeUser(), '/groups': [], '/requests': [] });

    component.formDob = 'not a date';
    component.onSave();

    mock.expectOne(r => r.method === 'PUT')
      .flush({ error: 'That is not a valid date of birth' }, { status: 400, statusText: 'Bad Request' });

    expect(component.formError()).toContain('valid date of birth');
    expect(component.saving()).toBe(false);
  });

  it('uploads a picked photo, shows it, and refreshes the session for the navbar', async () => {
    await build();
    flushByUrl(mock, { '/users/': makeUser(), '/groups': [], '/requests': [] });

    component.onAvatarChosen(pick());
    expect(component.uploadingAvatar()).toBe(true);
    mock.expectOne(r => r.method === 'POST' && r.url.endsWith('/avatar'))
      .flush(makeUser({ avatarUrl: '/uploads/me.png' }));

    expect(component.avatarSrc()).toBe('http://localhost:3000/uploads/me.png');
    expect(JSON.parse(localStorage.getItem('user')!).avatarUrl).toBe('/uploads/me.png');
    expect(component.uploadingAvatar()).toBe(false);
  });

  it('refuses a file that is not an allowed image, or is over 5 MB, before uploading', async () => {
    await build();
    flushByUrl(mock, { '/users/': makeUser(), '/groups': [], '/requests': [] });

    component.onAvatarChosen(pick('image/svg+xml'));
    expect(component.avatarError()).toContain('PNG');
    component.onAvatarChosen(pick('image/png', 5 * 1024 * 1024 + 1));
    expect(component.avatarError()).toContain('5 MB');

    mock.expectNone(r => r.url.endsWith('/avatar'));
  });

  it('removes the photo and goes back to the initial', async () => {
    await build();
    flushByUrl(mock, { '/users/': makeUser({ avatarUrl: '/uploads/me.png' }), '/groups': [], '/requests': [] });
    expect(component.avatarSrc()).not.toBe('');

    component.onRemoveAvatar();
    mock.expectOne(r => r.method === 'DELETE' && r.url.endsWith('/avatar')).flush(makeUser({ avatarUrl: '' }));

    expect(component.avatarSrc()).toBe('');
  });
});
