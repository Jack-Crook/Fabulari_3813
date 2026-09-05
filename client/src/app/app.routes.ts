import { Routes } from '@angular/router';
import { Register } from './register/register'; // the component to show on /register
import { Login } from './login/login';
import { UserDashboard } from './user-dashboard/user-dashboard';
import { Profile } from './profile/profile';
import { AdminDashboard } from './admin-dashboard/admin-dashboard';
import { SuperAdminDashboard } from './super-admin-dashboard/super-admin-dashboard';
import { GroupView } from './group-view/group-view';
import { ChatRoom } from './chat-room/chat-room';
import { authGuard, superAdminGuard, groupAdminGuard } from './guards';

export const routes: Routes = [
  { path: 'register', component: Register },      // localhost:4200/register -> Register component
  { path: 'login', component: Login},
  { path: '', redirectTo: 'login', pathMatch: 'full' }, // nothing at the root, so send people to the login page

  // canActivate runs before the component is built. login and register are the only two routes
  // without a guard, because they're the pages you use when you aren't signed in yet.
  {path: 'user-dashboard', component: UserDashboard, canActivate: [authGuard]},
  {path: 'profile', component: Profile, canActivate: [authGuard]},

  // two guards, run in order: signed in at all, then an admin of this particular group.
  // groupAdminGuard has to read :groupId out of the route, which is why the page is
  // parameterised — a user can admin any number of groups.
  {path: 'admin-dashboard/:groupId', component: AdminDashboard, canActivate: [authGuard, groupAdminGuard]},

  {path: 'super-admin-dashboard', component: SuperAdminDashboard, canActivate: [authGuard, superAdminGuard]},
  {path: 'groups/:id', component: GroupView, canActivate: [authGuard]},                                  // :id is the group being opened
  {path: 'groups/:groupId/channels/:channelId', component: ChatRoom, canActivate: [authGuard]},          // one room inside that group

  { path: '**', redirectTo: 'login' }          // any unmatched url, e.g. a typo, otherwise renders a blank page — router-outlet has nothing to put there. must stay last, first match wins.
];
