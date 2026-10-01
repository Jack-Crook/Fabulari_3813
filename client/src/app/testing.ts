import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Group, Channel } from './group';
import { AppRequest } from './request';
import { AppUser } from './auth';
import { ChatService } from './chat';

// shared setup for every spec file.
//
// the providers every component needs (router, http). provideHttpClientTesting swaps the real
// backend for one that queues requests, so a test checks what was asked for and gives a fixed reply.
export function testProviders() {
  return [
    provideRouter([]),            // ActivatedRoute and RouterLink need it
    provideHttpClient(),
    provideHttpClientTesting(),   // after provideHttpClient, it overrides its backend
    { provide: ChatService, useValue: fakeLiveUpdates() },   // no real socket in unit tests
  ];
}

// pages listen for live request updates through ChatService.onRequestsChanged. this stands in for
// it, and keeps the page's callback so a test can pretend the server announced a change.
// (the chat room spec provides its own, fuller fake, which replaces this one.)
export const liveUpdates: { announce: ((groupId: string | null) => void) | null } = { announce: null };

function fakeLiveUpdates() {
  return {
    onRequestsChanged(callback: (groupId: string | null) => void) {
      liveUpdates.announce = callback;
      return () => { liveUpdates.announce = null; };
    },
  };
}

// answers the requests a component makes
export function httpMock() {
  return TestBed.inject(HttpTestingController);
}

// node 26 has its own broken localStorage that hides jsdom's and throws when used. if so, an
// in-memory one with the same API is installed, so Auth still runs its real code.
function installLocalStorageIfMissing() {
  try {
    globalThis.localStorage.getItem('probe');
    return;                     // the real one works
  } catch {
    // install the stand-in
  }

  const store = new Map<string, string>();
  const shim: Storage = {
    getItem: (key: string) => store.has(key) ? store.get(key)! : null,   // null for a missing key, like the real one
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };

  // node's localStorage is a getter, so plain assignment would be ignored
  Object.defineProperty(globalThis, 'localStorage', {
    value: shim,
    configurable: true,
    writable: true,
  });
}

installLocalStorageIfMissing();

export function signIn(email: string, role = 'user', username = 'tester') {
  localStorage.setItem('user', JSON.stringify({ email, role, username }));
}

export function signOut() {
  localStorage.removeItem('user');
}

// builders with defaults, so a test only sets the fields it cares about
export function makeGroup(overrides: Partial<Group> = {}): Group {
  return {
    _id: 'g1',
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
  return { _id: 'c1', groupId: 'g1', name: 'General', ...overrides };
}

export function makeRequest(overrides: Partial<AppRequest> = {}): AppRequest {
  return {
    _id: 'r1',
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
    avatarUrl: '',
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

// answers open requests by url, since components fire several at startup in no fixed order
export function flushByUrl(mock: HttpTestingController, answers: Record<string, any>) {
  Object.entries(answers).forEach(([urlPart, body]) => {
    mock.match(req => req.url.includes(urlPart)).forEach(req => req.flush(body));
  });
}
