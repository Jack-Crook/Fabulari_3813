import { Component, inject, signal } from '@angular/core';   // signal = angular's reactive value holder
import { RouterLink } from '@angular/router';
import { Navbar } from '../navbar/navbar'
import { Auth } from '../auth';
import { GroupService, Group } from '../group';

@Component({
  selector: 'app-user-dashboard',
  imports: [Navbar, RouterLink],
  templateUrl: './user-dashboard.html',
  styleUrl: './user-dashboard.css',
})
export class UserDashboard {
  private groupService = inject(GroupService);
  private auth = inject(Auth);

  private me = this.auth.getUser()?.email ?? '';   // whoever is logged in, used to split the two lists

  // these are signals, not plain arrays. this app is zoneless (there's no zone.js), so angular only
  // rerenders when a signal changes. setting a normal property inside a subscribe would update the
  // value but leave the screen showing the old empty list until something else triggered a redraw.
  myGroups = signal<Group[]>([]);     // groups this user is already a member of
  discover = signal<Group[]>([]);     // everything else, the groups they could ask to join

  constructor() {
    this.groupService.getGroups().subscribe(groups => {
      // one call to /groups fills both panels, the difference is just whether the
      // logged in user's email is in that group's member list
      this.myGroups.set(groups.filter(g => g.memberEmails.includes(this.me)));
      this.discover.set(groups.filter(g => !g.memberEmails.includes(this.me)));
    });
  }
}
