import { Component, inject, signal, computed } from '@angular/core';   // signal = angular's reactive value holder
import { FormsModule } from '@angular/forms';                // lets the html use [(ngModel)] on the create form
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';    // the type of error http requests give back
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

  private me = this.auth.email;   // whoever is logged in, used to split the two lists
  isSuper = this.auth.isSuper;    // the super admin can't be a member of any group (see server.js), so the member-split below doesn't apply to them

  // these are signals, not plain arrays. this app is zoneless (there's no zone.js), so angular only
  // rerenders when a signal changes. setting a normal property inside a subscribe would update the
  // value but leave the screen showing the old empty list until something else triggered a redraw.
  myGroups = signal<Group[]>([]);     // groups this user is already a member of
  discover = signal<Group[]>([]);     // everything else, the groups they could join
  myPending = signal<AppRequest[]>([]);   // their own pending requests, so a submitted one is visible straight away

  // a signal rather than a plain boolean because onRequestGroup closes the form from inside a
  // subscribe callback, which is exactly the async case that needs one.
  showForm = signal(false);

  // the group request fields. plain properties, because [(ngModel)] writes to them from a DOM
  // event and angular already schedules a redraw after those.
  newName = '';
  newDescription = '';
  newAgeLimit = 0;
  newTheme = '#5FA8D3';       // the same default the server falls back to

  // the Discover search box. a signal rather than an [(ngModel)] property, because the
  // filtered list below is a computed that has to re-run when it changes. the template calls
  // searchTerm.set() straight from the input event.
  searchTerm = signal('');

  // one pair of messages shared by the request form and the join buttons, so feedback always
  // turns up in the same place. signals, because both are set inside subscribe callbacks.
  formError = signal('');
  formSuccess = signal('');
  submitting = signal(false);

  // computed re-runs by itself whenever either signal it reads changes, so typing in the search
  // box refilters the list without any extra wiring
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

  // pulled out of the constructor so it can be called again after joining a group or raising a
  // request, which is what makes the change appear without a page refresh
  private loadGroups() {
    this.groupService.getGroups().subscribe(groups => {
      if (this.isSuper) {
        // the super admin oversees every group, not just ones they've joined, so they see
        // all of them here instead of a member/non-member split
        this.myGroups.set(groups);
        this.discover.set([]);
        return;
      }
      // one call to /groups fills both panels, the difference is just whether the
      // logged in user's email is in that group's member list
      this.myGroups.set(groups.filter(g => g.memberEmails.includes(this.me)));
      this.discover.set(groups.filter(g => !g.memberEmails.includes(this.me)));
    });

    // the super admin can't raise requests at all, so there's nothing to fetch for them
    if (!this.isSuper) {
      this.requestService.getRequests({ requestedBy: this.me, status: 'pending' })
        .subscribe(requests => this.myPending.set(requests));
    }
  }

  // group admin is a relationship with a group rather than a role on the account, so "am I an
  // admin here" is a lookup in that group's adminEmails. a method rather than a computed
  // because it takes an argument — one answer per group row.
  amAdminOf(group: Group) {
    return group.adminEmails.includes(this.me);
  }

  toggleForm() {
    this.showForm.update(open => !open);   // update() reads the current value and writes the new one
    this.formError.set('');                // don't leave a message from a previous attempt hanging around
    this.formSuccess.set('');
  }

  // the spec says a group is requested from the super admin rather than created directly, and
  // that the requesting user supplies the title, description, age limit and colour up front —
  // the super admin doesn't fill them in after approving. so the whole form goes in the payload
  // and the group only exists once it's approved, at which point the requester becomes its
  // first admin.
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
        // express sends its errors as { error: '...' }, and that body lands on err.error
        this.formError.set(err.error?.error ?? 'Something went wrong, please try again.');
        this.submitting.set(false);
      },
    });
  }

  // joining is direct, not a request. the spec only puts one check on it — the group's age
  // limit — and the server does that check, answering 403 when the user is too young or hasn't
  // set a date of birth yet.
  onJoin(group: Group) {
    this.formError.set('');
    this.formSuccess.set('');

    this.groupService.joinGroup(group.id, this.me).subscribe({
      next: () => {
        this.formSuccess.set(`Joined ${group.name}.`);
        this.loadGroups();    // the group moves out of Discover and into My Groups
      },
      error: (err: HttpErrorResponse) => {
        this.formError.set(err.error?.error ?? 'Something went wrong, please try again.');
      },
    });
  }

  // leaving is the same endpoint as a group admin removing someone — it's a group level
  // removal either way. the server answers 409 if this would leave the group with no admin,
  // which is the case the spec covers by making disbanding a request to the super admin.
  onLeave(group: Group) {
    this.formError.set('');
    this.formSuccess.set('');

    this.groupService.removeMember(group.id, this.me, this.me).subscribe({
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
