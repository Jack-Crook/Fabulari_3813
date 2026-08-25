import { Routes } from '@angular/router';
import { Register } from './register/register'; // the component to show on /register
import { Login } from './login/login';
import { UserDashboard } from './user-dashboard/user-dashboard';
import { Profile } from './profile/profile';
import { AdminDashboard } from './admin-dashboard/admin-dashboard';
import { SuperAdminDashboard } from './super-admin-dashboard/super-admin-dashboard';
import { GroupView } from './group-view/group-view';
import { ChatRoom } from './chat-room/chat-room';

export const routes: Routes = [
  { path: 'register', component: Register },      // localhost:4200/register -> Register component
  { path: 'login', component: Login},
  { path: '', redirectTo: 'login', pathMatch: 'full' }, // nothing at the root, so send people to the login page
  {path: 'user-dashboard', component: UserDashboard},
  {path: 'profile', component: Profile},
  {path: 'admin-dashboard/:groupId', component: AdminDashboard},
  {path: 'super-admin-dashboard', component: SuperAdminDashboard},
  {path: 'groups/:id', component: GroupView},                                  // :id is the group being opened
  {path: 'groups/:groupId/channels/:channelId', component: ChatRoom}           // one room inside that group

];
