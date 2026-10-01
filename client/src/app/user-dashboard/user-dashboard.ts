import { Component, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { Navbar } from '../navbar/navbar'
import { Auth } from '../auth';
import { GroupService, Group } from '../group';
import { RequestService, AppRequest } from '../request';

@Component({
  selector: 'app-user-dashboard',
  imports: [Navbar, RouterLink, FormsModule],
  templateUrl: './user-dashboard.html',
  styleUrl: './user-dashboard.css',
})
export class UserDashboard {
  private groupService = inject(GroupService);
  private requestService = inject(RequestService);
  private auth = inject(Auth);

  private me = this.auth.email;
  isSuper = this.auth.isSuper;    // the super admin is in no groups, so sees them all

  // signals, since they're set in subscribe and the app is zoneless
  myGroups = signal<Group[]>([]);     // groups I'm in
  discover = signal<Group[]>([]);     // groups I could join
  myPending = signal<AppRequest[]>([]);   // my pending requests

  showForm = signal(false);       // a signal, it's closed from inside subscribe

  // request form fields. plain, [(ngModel)] writes them from DOM events
  newName = '';
  newDescription = '';
  newAgeLimit = 0;
  newTheme = '#5FA8D3';       // the server's default

  // a signal so filteredDiscover re-runs as you type
  searchTerm = signal('');

  // one message bar for the whole page
  formError = signal('');
  formSuccess = signal('');
  submitting = signal(false);

  // re-runs whenever the search term or the list changes
  filteredDiscover = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    if (!term) {
      return this.discover();
    }
    return this.discover().filter(g =>
      g.name.toLowerCase().includes(term) || g.description.toLowerCase().includes(term));
  });

  constructor() {
    this.loadGroups();
  }

  // called again after any change, so the page updates without a refresh
  private loadGroups() {
    this.groupService.getGroups().subscribe(groups => {
      if (this.isSuper) {
        // the super admin sees every group
        this.myGroups.set(groups);
        this.discover.set([]);
        return;
      }
      // one call fills both panels, split on membership
      this.myGroups.set(groups.filter(g => g.memberEmails.includes(this.me)));
      this.discover.set(groups.filter(g => !g.memberEmails.includes(this.me)));
    });

    // the super admin can't raise requests
    if (!this.isSuper) {
      this.requestService.getRequests({ requestedBy: this.me, status: 'pending' })
        .subscribe(requests => this.myPending.set(requests));
    }
  }

  // group admin is stored on the group. a method, since it's per row.
  amAdminOf(group: Group) {
    return group.adminEmails.includes(this.me);
  }

  toggleForm() {
    this.showForm.update(open => !open);   // update() reads the current value and writes the new one
    this.formError.set('');                // don't leave a message from a previous attempt hanging around
    this.formSuccess.set('');
  }

  // groups are requested, not created. all the details go in the request, and the requester
  // becomes the first admin once the super admin approves.
  onRequestGroup() {
    if (this.submitting()) {
      return;
    }
    this.submitting.set(true);
    this.formError.set('');
    this.formSuccess.set('');

    const payload = {
      name: this.newName,
      description: this.newDescription,
      ageLimit: Number(this.newAgeLimit),
      theme: this.newTheme,
    };

    this.requestService.raise('group-create', this.me, payload).subscribe({
      next: () => {
        this.formSuccess.set(`Requested "${this.newName}". The super admin will review it, and you'll be its first admin if it's approved.`);
        this.newName = '';
        this.newDescription = '';
        this.newAgeLimit = 0;
        this.newTheme = '#5FA8D3';
        this.showForm.set(false);
        this.submitting.set(false);
        this.loadGroups();
      },
      error: (err: HttpErrorResponse) => {
        // the server's { error } body
        this.formError.set(err.error?.error ?? 'Something went wrong, please try again.');
        this.submitting.set(false);
      },
    });
  }

  // joining is direct. the server refuses (403) if too young or no date of birth.
  onJoin(group: Group) {
    this.formError.set('');
    this.formSuccess.set('');

    this.groupService.joinGroup(group._id, this.me).subscribe({
      next: () => {
        this.formSuccess.set(`Joined ${group.name}.`);
        this.loadGroups();    // moves it from Discover to My Groups
      },
      error: (err: HttpErrorResponse) => {
        this.formError.set(err.error?.error ?? 'Something went wrong, please try again.');
      },
    });
  }

  // same endpoint as an admin removing someone. 409 if you're the last admin.
  onLeave(group: Group) {
    this.formError.set('');
    this.formSuccess.set('');

    this.groupService.removeMember(group._id, this.me, this.me).subscribe({
      next: () => {
        this.formSuccess.set(`Left ${group.name}.`);
        this.loadGroups();
      },
      error: (err: HttpErrorResponse) => {
        this.formError.set(err.error?.error ?? 'Something went wrong, please try again.');
      },
    });
  }
}
