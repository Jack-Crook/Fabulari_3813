import { Routes } from '@angular/router';
import { Register } from './register/register';
import { Login } from './login/login';
import { UserDashboard } from './user-dashboard/user-dashboard';
import { Profile } from './profile/profile';
import { AdminDashboard } from './admin-dashboard/admin-dashboard';
import { SuperAdminDashboard } from './super-admin-dashboard/super-admin-dashboard';
import { GroupView } from './group-view/group-view';
import { ChatRoom } from './chat-room/chat-room';
import { authGuard, superAdminGuard, groupAdminGuard } from './guards';

// `title` sets the browser tab's title on each page. it's also the first thing a screen reader
// announces after a navigation, so every page needs its own rather than all being "Fabulari".
export const routes: Routes = [
  { path: 'register', component: Register, title: 'Register | Fabulari' },      // /register -> Register
  { path: 'login', component: Login, title: 'Log in | Fabulari' },
  { path: '', redirectTo: 'login', pathMatch: 'full' }, // the root goes to login

  // canActivate runs before the component is built. only login and register are unguarded.
  {path: 'user-dashboard', component: UserDashboard, canActivate: [authGuard], title: 'Dashboard | Fabulari'},
  {path: 'profile', component: Profile, canActivate: [authGuard], title: 'Profile | Fabulari'},

  // signed in, then an admin of this group. :groupId because a user can admin many groups.
  {path: 'admin-dashboard/:groupId', component: AdminDashboard, canActivate: [authGuard, groupAdminGuard], title: 'Group admin | Fabulari'},

  {path: 'super-admin-dashboard', component: SuperAdminDashboard, canActivate: [authGuard, superAdminGuard], title: 'Super admin | Fabulari'},
  {path: 'groups/:id', component: GroupView, canActivate: [authGuard], title: 'Group | Fabulari'},
  {path: 'groups/:groupId/channels/:channelId', component: ChatRoom, canActivate: [authGuard], title: 'Chat room | Fabulari'},          // one room in a group

  { path: '**', redirectTo: 'login' }          // anything unknown goes to login. must be last, the first match wins.
];
