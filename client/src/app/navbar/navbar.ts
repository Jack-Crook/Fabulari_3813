import { Component, inject, signal, computed, ElementRef, viewChild } from '@angular/core';
import { RouterLink, RouterLinkActive, Router, NavigationEnd } from '@angular/router';
import { Auth } from '../auth';
import { GroupService, Group } from '../group';


@Component({
  selector: 'app-navbar',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './navbar.html',
  styleUrl: './navbar.css',
  // document listeners, so the account menu closes on a click elsewhere or Escape
  host: {
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'closeMenu(true)',
  },
})


export class Navbar {
  private auth = inject(Auth);
  private router = inject(Router);
  private groupService = inject(GroupService);
  private host = inject(ElementRef<HTMLElement>);    // to tell clicks inside the navbar from outside


  me = this.auth.email;       // shown in the account menu

  // from auth.session, so a name or picture change shows straight away
  displayName = computed(() => this.auth.session()?.username || this.me);

  // the avatar letter when there's no picture
  initial = computed(() => (this.displayName().charAt(0) || '?').toUpperCase());

  // the profile picture, or '' to show the initial
  avatarSrc = computed(() => {
    const url = this.auth.session()?.avatarUrl;
    return url ? this.auth.avatarSrc(url) : '';
  });

  // a signal, since the document listeners and navigation also close it
  menuOpen = signal(false);

  // focus returns here when Escape closes the menu
  private accountButton = viewChild<ElementRef<HTMLButtonElement>>('accountButton');

  // plain value: super admin doesn't depend on the current page
  isSuperAdmin = this.auth.isSuper;

  private groups = signal<Group[]>([]);      // fetched once
  currentGroupId = signal('');               // the group in the url, '' when not on a group page


  // re-runs when groups or the current group change, so the link shows on the right pages
  isGroupAdmin = computed(() => {
    const current = this.groups().find(g => g._id === this.currentGroupId());
    return current?.adminEmails.includes(this.me) ?? false;
  });


  constructor() {
    if (this.me) {
      this.groupService.getGroups().subscribe(groups => this.groups.set(groups));
    }

    this.readGroupFromUrl();

    // the navbar isn't rebuilt between group pages, so re-read the url on every navigation
    this.router.events.subscribe(event => {
      if (event instanceof NavigationEnd) {
        this.readGroupFromUrl();
        this.menuOpen.set(false);     // don't leave the menu open on the next page
      }
    });
  }


  // /groups/:id, /groups/:id/channels/:c and /admin-dashboard/:id all have the group id third
  private readGroupFromUrl() {
    const segments = this.router.url.split('/');
    const onAGroupPage = segments[1] === 'groups' || segments[1] === 'admin-dashboard';
    this.currentGroupId.set(onAGroupPage ? (segments[2] ?? '') : '');
  }



  toggleMenu() {
    this.menuOpen.update(open => !open);
  }

  // Escape returns focus to the button, only if the menu was open
  closeMenu(returnFocus = false) {
    if (!this.menuOpen()) {
      return;
    }
    this.menuOpen.set(false);
    if (returnFocus) {
      this.accountButton()?.nativeElement.focus();
    }
  }

  // close on a click outside the navbar
  onDocumentClick(event: MouseEvent) {
    if (!this.host.nativeElement.contains(event.target as Node)) {
      this.closeMenu();
    }
  }

  onLogout() {
    this.auth.logout();
    this.router.navigateByUrl('/login');
  }
}
