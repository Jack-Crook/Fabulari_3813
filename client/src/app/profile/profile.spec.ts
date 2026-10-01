import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { Profile } from './profile';
import { testProviders, signIn, signOut, makeGroup, makeUser, makeRequest, flushByUrl } from '../testing';

// a fake (change) event. the size can be faked for the 5 MB test.
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
    // loaded from the server, localStorage goes stale
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

    // worked out from the date of birth, like the server does
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

    // only pending and rejected requests are listed
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

    // admin of one group, plain member of the other
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
    // no password field means unchanged
    expect(req.request.body.password).toBeUndefined();
    expect(req.request.body.username).toBe('New Name');
    req.flush(makeUser({ username: 'New Name' }));
  });

  it('checks the form before saving: an invalid date of birth never reaches the server', async () => {
    await build();
    flushByUrl(mock, { '/users/': makeUser(), '/groups': [], '/requests': [] });

    component.formUsername = 'member';
    component.formDob = 'not a date';
    component.onSave();

    mock.expectNone(r => r.method === 'PUT');
    expect(component.formError()).toContain('valid date of birth');
    expect(component.saving()).toBe(false);
  });

  it('shows the server\'s message when it refuses the save', async () => {
    await build();
    flushByUrl(mock, { '/users/': makeUser(), '/groups': [], '/requests': [] });

    component.formUsername = 'member';
    component.onSave();
    mock.expectOne(r => r.method === 'PUT')
      .flush({ error: 'You can only edit your own profile' }, { status: 403, statusText: 'Forbidden' });

    expect(component.formError()).toContain('own profile');
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
