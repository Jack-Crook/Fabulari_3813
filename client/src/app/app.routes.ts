import { Routes } from '@angular/router';
import { Register } from './register/register'; // the component to show on /register
import { Login } from './login/login';
import { UserDashboard } from './user-dashboard/user-dashboard';

export const routes: Routes = [
  { path: 'register', component: Register },      // localhost:4200/register -> Register component
  { path: 'login', component: Login},
  { path: '', redirectTo: 'login', pathMatch: 'full' }, // temporary landing page until login exists
  {path: 'user-dashboard', component: UserDashboard}
];
