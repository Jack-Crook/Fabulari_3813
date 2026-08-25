import { Component, inject } from '@angular/core';
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

  myGroups: Group[] = [];       // groups this user is already a member of
  discover: Group[] = [];       // everything else, the groups they could ask to join

  constructor() {
    this.groupService.getGroups().subscribe(groups => {
      // one call to /groups fills both panels, the difference is just whether the
      // logged in user's email is in that group's member list
      this.myGroups = groups.filter(g => g.memberEmails.includes(this.me));
      this.discover = groups.filter(g => !g.memberEmails.includes(this.me));
    });
  }
}
