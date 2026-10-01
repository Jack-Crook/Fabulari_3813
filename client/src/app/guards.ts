import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { Auth } from './auth';
import { GroupService } from './group';

// route guards run before a route's component is built: true lets it through, a UrlTree
// redirects. functions, since class guards are deprecated.
//
// not security: they read localStorage, which the user can edit. they only stop the wrong page
// rendering. the server enforces the real rules.

// signed in at all. on everything except login and register.
export const authGuard: CanActivateFn = () => {
  const auth = inject(Auth);
  const router = inject(Router);

  return auth.email ? true : router.createUrlTree(['/login']);
};

// super admin is the role stored on the user, so a straight read
export const superAdminGuard: CanActivateFn = () => {
  const auth = inject(Auth);
  const router = inject(Router);

  return auth.isSuper ? true : router.createUrlTree(['/user-dashboard']);
};

// group admin is stored on the group (adminEmails), so the group is fetched first. the router
// waits for the observable.
export const groupAdminGuard: CanActivateFn = (route) => {
  const auth = inject(Auth);
  const router = inject(Router);
  const groupService = inject(GroupService);

  const groupId = route.paramMap.get('groupId') ?? '';
  const me = auth.email;

  if (!me) {
    return router.createUrlTree(['/login']);
  }

  return groupService.getGroups().pipe(
    map(groups => {
      const group = groups.find(g => g._id === groupId);
      return group?.adminEmails.includes(me)
        ? true
        : router.createUrlTree(['/user-dashboard']);
    })
  );
};
