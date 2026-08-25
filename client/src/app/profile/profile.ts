import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';   // lets the html use routerLink
import { Navbar } from '../navbar/navbar';
import { Auth } from '../auth';
import { GroupService } from '../group';

@Component({
  selector: 'app-profile',
  imports: [Navbar, RouterLink],
  templateUrl: './profile.html',
  styleUrl: './profile.css',
})
export class Profile {
  private auth = inject(Auth);
  private groupService = inject(GroupService);
  private user = this.auth.getUser();     // whoever is logged in, or null if nobody is

  email = this.user?.email ?? '';
  role = this.user?.role ?? 'user';
  username = this.user?.email.split('@')[0] ?? '';  // there's no username field yet, so use the part before the @

  // a signal because it's set inside a subscribe, and the app is zoneless
  groups = signal(0);   // how many groups this user is a member of

  constructor() {
    if (this.email) {
      this.groupService.getGroups().subscribe(groups => {
        this.groups.set(groups.filter(g => g.memberEmails.includes(this.email)).length);
      });
    }
  }
}
