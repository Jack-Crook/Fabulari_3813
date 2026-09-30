import { Component, inject, signal, computed, ElementRef, viewChild } from '@angular/core';
import { RouterLink, RouterLinkActive, Router, NavigationEnd } from '@angular/router';
import { Auth } from '../auth';
import { GroupService, Group } from '../group';


@Component({
  selector: 'app-navbar',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './navbar.html',
  styleUrl: './navbar.css',
  // listeners on the whole document, not just the navbar, because the account menu should close
  // when you click anywhere else on the page or press Escape, which is how people expect a
  // dropdown to behave
  host: {
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'closeMenu(true)',
  },
})


export class Navbar {
  private auth = inject(Auth);
  private router = inject(Router);
  private groupService = inject(GroupService);
  private host = inject(ElementRef<HTMLElement>);    // this navbar's own element, to tell a click inside it from one outside


  me = this.auth.email;       // not private, the account menu shows it under the name

  // the account menu on the right says which account you're acting as, which matters a lot on
  // this app because the same page looks different per role
  displayName = this.auth.getUser()?.username || this.me;

  // the letter in the avatar circle. the same idea as the profile page's avatar: there are no
  // uploaded profile pictures, so the first letter of the name stands in for one
  initial = (this.displayName.charAt(0) || '?').toUpperCase();

  // a signal because it's also closed from the document listeners and from a navigation event,
  // not only from a click on the button itself
  menuOpen = signal(false);

  // the avatar button, so focus can go back to it when Escape closes the menu. otherwise a
  // keyboard user is left focused on something that just disappeared
  private accountButton = viewChild<ElementRef<HTMLButtonElement>>('accountButton');

  // not a computed like isGroupAdmin below, because it doesn't depend on which page you're on.
  // super admin authority is system wide rather than tied to one group, so the link is always
  // there for them, the same as Dashboard and Profile are for everyone.
  isSuperAdmin = this.auth.isSuper;

  private groups = signal<Group[]>([]);      // every group, fetched once
  // not private, the template reads it to build the group admin link
  currentGroupId = signal('');               // the group in the url, empty when we aren't on a group page


  // computed works out its own value from other signals, and re-runs whenever any of them
  // change. so the link appears and disappears as you move around without any extra wiring.
  isGroupAdmin = computed(() => {
    const current = this.groups().find(g => g._id === this.currentGroupId());
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
        this.menuOpen.set(false);     // picking Profile from the menu shouldn't leave it open on the next page
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



  toggleMenu() {
    this.menuOpen.update(open => !open);
  }

  // Escape closes the menu and puts focus back on the avatar button. only when it was actually
  // open, so pressing Escape somewhere else on the page doesn't steal focus into the navbar.
  closeMenu(returnFocus = false) {
    if (!this.menuOpen()) {
      return;
    }
    this.menuOpen.set(false);
    if (returnFocus) {
      this.accountButton()?.nativeElement.focus();
    }
  }

  // a click anywhere outside the navbar closes the menu. clicks inside it are left alone, the
  // button toggles it itself and the links close it by navigating.
  onDocumentClick(event: MouseEvent) {
    if (!this.host.nativeElement.contains(event.target as Node)) {
      this.closeMenu();
    }
  }

  onLogout() {                          // runs when the logout button is clicked
    this.auth.logout();                 // clear the stored user first
    this.router.navigateByUrl('/login');// then send them back to the login page
  }
}
