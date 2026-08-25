import { Component, inject, signal, computed } from '@angular/core';
import { RouterLink, RouterLinkActive, Router, NavigationEnd } from '@angular/router';
import { Auth } from '../auth';
import { GroupService, Group } from '../group';


@Component({
  selector: 'app-navbar',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './navbar.html',
  styleUrl: './navbar.css',
})


export class Navbar {
  private auth = inject(Auth);
  private router = inject(Router);
  private groupService = inject(GroupService);


  private me = this.auth.getUser()?.email ?? '';

  private groups = signal<Group[]>([]);      // every group, fetched once
  // not private, the template reads it to build the group admin link
  currentGroupId = signal('');               // the group in the url, empty when we aren't on a group page


  // computed works out its own value from other signals, and re-runs whenever any of them
  // change. so the link appears and disappears as you move around without any extra wiring.
  isGroupAdmin = computed(() => {
    const current = this.groups().find(g => g.id === this.currentGroupId());
    return current?.adminEmails.includes(this.me) ?? false;
  });



  constructor() {
    if (this.me) {
      this.groupService.getGroups().subscribe(groups => this.groups.set(groups));
    }

    this.readGroupFromUrl();      // the url is already correct when this component is built

    // switching between two groups reuses the same components, so the navbar isn't rebuilt
    // and the url has to be re-read on every navigation
    this.router.events.subscribe(event => {
      if (event instanceof NavigationEnd) {
        this.readGroupFromUrl();
      }
    });
  }


  // urls are /groups/g1, /groups/g1/channels/c2 or /admin-dashboard/g1, so in all of them
  // the group id is the third segment. admin-dashboard is included so the link stays visible
  // and highlighted once you're actually on the admin page.
  private readGroupFromUrl() {
    const segments = this.router.url.split('/');
    const onAGroupPage = segments[1] === 'groups' || segments[1] === 'admin-dashboard';
    this.currentGroupId.set(onAGroupPage ? (segments[2] ?? '') : '');
  }



  onLogout() {                          // runs when the logout button is clicked
    this.auth.logout();                 // clear the stored user first
    this.router.navigateByUrl('/login');// then send them back to the login page
  }
}
