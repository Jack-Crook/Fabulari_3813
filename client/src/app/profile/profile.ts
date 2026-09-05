import { Component, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';   // lets the html use [(ngModel)] on the edit form
import { RouterLink } from '@angular/router';   // lets the html use routerLink
import { DatePipe } from '@angular/common';     // formats the stored ISO timestamps in the template
import { HttpErrorResponse } from '@angular/common/http';
import { Navbar } from '../navbar/navbar';
import { Auth, AppUser, ProfileChanges } from '../auth';
import { GroupService, Group } from '../group';
import { RequestService, AppRequest } from '../request';

@Component({
  selector: 'app-profile',
  imports: [Navbar, RouterLink, FormsModule, DatePipe],
  templateUrl: './profile.html',
  styleUrl: './profile.css',
})
export class Profile {
  private auth = inject(Auth);
  private groupService = inject(GroupService);
  private requestService = inject(RequestService);

  email = this.auth.email;    // the one field that can't be edited, because it identifies the account

  // signals throughout, because every one of these is set inside a subscribe callback and the
  // app is zoneless — a plain property would hold the right value but leave the screen stale
  user = signal<AppUser | undefined>(undefined);
  myGroups = signal<Group[]>([]);
  myRequests = signal<AppRequest[]>([]);

  editing = signal(false);
  formError = signal('');
  formSuccess = signal('');
  saving = signal(false);

  // the edit form's fields. plain properties, because [(ngModel)] writes to them from a DOM
  // event and angular already schedules a redraw after those.
  formUsername = '';
  formDob = '';
  formBio = '';
  formPassword = '';       // blank means "leave the password alone", it isn't sent when empty

  // the spec says a user can see their own pending requests and their own past rejected ones.
  // computed derives both from the one list rather than making two calls, and re-runs by itself
  // whenever myRequests changes.
  pendingRequests = computed(() => this.myRequests().filter(r => r.status === 'pending'));
  rejectedRequests = computed(() => this.myRequests().filter(r => r.status === 'rejected'));

  // the groups this user actually admins, so the profile shows the relationship that isn't
  // stored on the user record anywhere
  adminOf = computed(() => this.myGroups().filter(g => g.adminEmails.includes(this.email)));

  // age isn't stored, it's worked out from the date of birth, the same way server.js does it
  age = computed(() => {
    const dob = this.user()?.dob;
    if (!dob) {
      return null;
    }
    const born = new Date(dob);
    const now = new Date();
    let years = now.getFullYear() - born.getFullYear();
    const monthsIn = now.getMonth() - born.getMonth();
    if (monthsIn < 0 || (monthsIn === 0 && now.getDate() < born.getDate())) {
      years = years - 1;
    }
    return years;
  });

  constructor() {
    this.load();
  }

  private load() {
    if (!this.email) {
      return;
    }

    // fetched from the server rather than read out of localStorage, because localStorage only
    // holds email/role/username and goes stale the moment the profile is edited
    this.auth.fetchUser(this.email).subscribe(user => this.user.set(user));

    this.groupService.getGroups().subscribe(groups => {
      this.myGroups.set(groups.filter(g => g.memberEmails.includes(this.email)));
    });

    this.requestService.getRequests({ requestedBy: this.email }).subscribe(requests => {
      this.myRequests.set(requests);
    });
  }

  startEditing() {
    // copy the stored values into the form so it opens showing what's actually saved
    const user = this.user();
    this.formUsername = user?.username ?? '';
    this.formDob = user?.dob ?? '';
    this.formBio = user?.bio ?? '';
    this.formPassword = '';
    this.formError.set('');
    this.formSuccess.set('');
    this.editing.set(true);
  }

  cancelEditing() {
    this.editing.set(false);
    this.formError.set('');
  }

  onSave() {
    if (this.saving()) {
      return;
    }
    this.saving.set(true);
    this.formError.set('');
    this.formSuccess.set('');

    // email and role aren't in here at all. email is the account's unique identifier so the
    // spec says it can't change, and role is what makes someone the super admin — letting a
    // user PUT their own role would be a way to promote themself.
    const changes: ProfileChanges = {
      username: this.formUsername,
      dob: this.formDob,
      bio: this.formBio,
    };

    // only sent when they actually typed a new one, so saving the form without touching the
    // password field leaves the stored password alone rather than blanking it
    if (this.formPassword) {
      changes.password = this.formPassword;
    }

    this.auth.updateProfile(this.email, changes).subscribe({
      next: updated => {
        this.user.set(updated);
        // the navbar reads the username out of localStorage, so the stored copy is refreshed
        // here too or it would keep showing the old one until the next login
        this.auth.saveUser({ email: updated.email, role: updated.role, username: updated.username });
        this.formSuccess.set('Profile saved.');
        this.editing.set(false);
        this.saving.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.formError.set(err.error?.error ?? 'Something went wrong, please try again.');
        this.saving.set(false);
      },
    });
  }

  // requests are stored with a type slug, this turns it into something readable in the table
  labelFor(type: string) {
    const labels: Record<string, string> = {
      'group-create': 'New group',
      'group-delete': 'Delete group',
      'channel-create': 'New room',
      'user-ban': 'Ban user',
    };
    return labels[type] ?? type;
  }
}
