import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Group, Channel } from './group';
import { AppRequest } from './request';
import { AppUser } from './auth';

// Shared setup for every spec file.
//
// The generated specs were `TestBed.configureTestingModule({ imports: [Cmp] })` with no
// providers at all, which is why nine of them failed: anything that injects HttpClient (through
// Auth or GroupService) or pulls in RouterLink (which needs ActivatedRoute) had nothing to
// inject. Rather than repeating the same three providers in eleven files, they live here.
//
// provideHttpClientTesting replaces the real HTTP backend with one that queues requests instead
// of sending them, so a test can assert what the component asked for and hand back a fixed
// answer. Without it user-dashboard.spec actually tried to reach localhost:3000.
export function testProviders() {
  return [
    provideRouter([]),            // ActivatedRoute and RouterLink both need the router present
    provideHttpClient(),
    provideHttpClientTesting(),   // must come after provideHttpClient, it overrides its backend
  ];
}

// the controller every test uses to answer the requests a component made on startup
export function httpMock() {
  return TestBed.inject(HttpTestingController);
}

// components read the signed in user out of localStorage, so tests have to put one there
// first. jsdom gives the tests a real localStorage, so this is the same code path as the app.
export function signIn(email: string, role = 'user', username = 'tester') {
  localStorage.setItem('user', JSON.stringify({ email, role, username }));
}

export function signOut() {
  localStorage.removeItem('user');
}

// small builders so a test can say what it cares about and let the rest default, instead of
// writing out every field of a Group every time
export function makeGroup(overrides: Partial<Group> = {}): Group {
  return {
    id: 'g1',
    name: 'Book Club',
    description: 'Fantasy readers',
    ageLimit: 0,
    theme: '#5FA8D3',
    adminEmails: ['admin@test.com'],
    memberEmails: ['admin@test.com', 'member@test.com'],
    bannedEmails: [],
    ...overrides,
  };
}

export function makeChannel(overrides: Partial<Channel> = {}): Channel {
  return { id: 'c1', groupId: 'g1', name: 'General', ...overrides };
}

export function makeRequest(overrides: Partial<AppRequest> = {}): AppRequest {
  return {
    id: 'r1',
    type: 'channel-create',
    status: 'pending',
    summary: 'Create room "Spoilers" in "Book Club"',
    requestedBy: 'member@test.com',
    groupId: 'g1',
    payload: { name: 'Spoilers' },
    createdAt: '2026-09-01T10:00:00.000Z',
    resolvedAt: '',
    resolvedBy: '',
    reason: '',
    ...overrides,
  };
}

export function makeUser(overrides: Partial<AppUser> = {}): AppUser {
  return {
    email: 'member@test.com',
    role: 'user',
    username: 'member',
    dob: '2000-01-01',
    bio: '',
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

// Several components fire more than one request the moment they're built — groups, channels
// and requests all at once — and the order isn't something a test should depend on. This
// answers whichever of them are open by matching on the URL, and ignores any that aren't.
export function flushByUrl(mock: HttpTestingController, answers: Record<string, any>) {
  Object.entries(answers).forEach(([urlPart, body]) => {
    mock.match(req => req.url.includes(urlPart)).forEach(req => req.flush(body));
  });
}
