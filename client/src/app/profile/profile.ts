import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';   // lets the html use routerLink
import { Navbar } from '../navbar/navbar';
import { Auth } from '../auth';

@Component({
  selector: 'app-profile',
  imports: [Navbar, RouterLink],
  templateUrl: './profile.html',
  styleUrl: './profile.css',
})
export class Profile {
  private auth = inject(Auth);
  private user = this.auth.getUser();     // whoever is logged in, or null if nobody is

  email = this.user?.email ?? '';
  role = this.user?.role ?? 'user';
  username = this.user?.email.split('@')[0] ?? '';  // there's no username field yet, so use the part before the @
  groups = 0;                                        // filled in once the dashboard talks to /groups
}

