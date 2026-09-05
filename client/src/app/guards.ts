import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { Auth } from './auth';
import { GroupService } from './group';

// Route guards. A guard is a function the router runs before it builds the component for a
// route: return true and the navigation happens, return a UrlTree and the router goes there
// instead. They're plain functions rather than classes because Angular's class based guards
// are deprecated, and inject() works the same way inside them as it does in a component.
//
// Worth saying out loud in the interview: this is not security. Everything these read comes
// out of localStorage, which the user owns and can edit, and the API doesn't check any of it.
// What guards actually buy is that typing /super-admin-dashboard as an ordinary user bounces
// you instead of rendering a page full of controls that will all fail. The real enforcement is
// the role and admin checks in server.js, which run whatever the client believes.

// signed in at all. everything except login and register sits behind this.
export const authGuard: CanActivateFn = () => {
  const auth = inject(Auth);
  const router = inject(Router);

  return auth.email ? true : router.createUrlTree(['/login']);
};

// there is exactly one super admin, and their role is the one thing stored on the user record,
// so this is a straight read rather than a lookup.
export const superAdminGuard: CanActivateFn = () => {
  const auth = inject(Auth);
  const router = inject(Router);

  return auth.isSuper ? true : router.createUrlTree(['/user-dashboard']);
};

// group admin isn't a role on the user — it's whether their email is in that group's
// adminEmails — so this one has to fetch the group before it can answer. Returning the
// observable is fine: the router waits for it to emit before deciding.
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
      const group = groups.find(g => g.id === groupId);
      return group?.adminEmails.includes(me)
        ? true
        : router.createUrlTree(['/user-dashboard']);
    })
  );
};
