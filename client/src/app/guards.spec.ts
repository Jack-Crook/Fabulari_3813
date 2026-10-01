import { TestBed } from '@angular/core/testing';
import { Router, ActivatedRouteSnapshot, RouterStateSnapshot, UrlTree, convertToParamMap } from '@angular/router';
import { HttpTestingController } from '@angular/common/http/testing';
import { firstValueFrom, isObservable } from 'rxjs';

import { authGuard, superAdminGuard, groupAdminGuard } from './guards';
import { testProviders, signIn, signOut, makeGroup } from './testing';

// guards are functions, run with runInInjectionContext. these stand in for the router's arguments.
const emptyRoute = { paramMap: convertToParamMap({}) } as unknown as ActivatedRouteSnapshot;
const emptyState = {} as RouterStateSnapshot;

function routeWithGroup(groupId: string) {
  return { paramMap: convertToParamMap({ groupId }) } as unknown as ActivatedRouteSnapshot;
}

describe('route guards', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: testProviders() });
    signOut();
  });

  afterEach(() => signOut());

  it('authGuard sends a signed out visitor to the login page', () => {
    const result = TestBed.runInInjectionContext(() => authGuard(emptyRoute, emptyState));

    expect(result instanceof UrlTree).toBe(true);
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/login');
  });

  it('authGuard lets a signed in user through', () => {
    signIn('member@test.com');
    expect(TestBed.runInInjectionContext(() => authGuard(emptyRoute, emptyState))).toBe(true);
  });

  it('superAdminGuard bounces an ordinary user to their dashboard', () => {
    signIn('member@test.com', 'user');
    const result = TestBed.runInInjectionContext(() => superAdminGuard(emptyRoute, emptyState));

    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/user-dashboard');
  });

  it('superAdminGuard lets the super admin through', () => {
    signIn('boss@test.com', 'super');
    expect(TestBed.runInInjectionContext(() => superAdminGuard(emptyRoute, emptyState))).toBe(true);
  });

  it('groupAdminGuard allows an admin of that particular group', async () => {
    signIn('admin@test.com');
    const result = TestBed.runInInjectionContext(() => groupAdminGuard(routeWithGroup('g1'), emptyState));

    // group admin is stored on the group, so this guard fetches it and returns an observable
    expect(isObservable(result)).toBe(true);

    // the request is only sent once firstValueFrom subscribes, so start the promise before answering
    const answer = firstValueFrom(result as any);
    TestBed.inject(HttpTestingController).expectOne('http://localhost:3000/groups').flush([makeGroup()]);
    expect(await answer).toBe(true);
  });

  it('groupAdminGuard blocks a plain member of that group', async () => {
    signIn('member@test.com');
    const result = TestBed.runInInjectionContext(() => groupAdminGuard(routeWithGroup('g1'), emptyState));

    const answer = firstValueFrom(result as any);
    TestBed.inject(HttpTestingController).expectOne('http://localhost:3000/groups').flush([makeGroup()]);
    expect(TestBed.inject(Router).serializeUrl(await answer as UrlTree)).toBe('/user-dashboard');
  });
});
