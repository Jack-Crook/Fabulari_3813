import { Routes } from '@angular/router';
import { Register } from './register/register'; // the component to show on /register

export const routes: Routes = [
  { path: 'register', component: Register },      // localhost:4200/register -> Register component
  { path: '', redirectTo: 'register', pathMatch: 'full' }, // temporary landing page until login exists
];
