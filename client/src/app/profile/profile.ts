import { Component, inject, signal, computed, DestroyRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';     // formats ISO dates in the template
import { HttpErrorResponse } from '@angular/common/http';
import { Navbar } from '../navbar/navbar';
import { Auth, AppUser, ProfileChanges } from '../auth';
import { GroupService, Group } from '../group';
import { RequestService, AppRequest } from '../request';
import { ChatService } from '../chat';
import { nameProblem, textProblem, dobProblem, passwordProblem, firstProblem } from '../validation';

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

  email = this.auth.email;    // not editable, it identifies the account

  // signals, since they're set in subscribe and the app is zoneless
  user = signal<AppUser | undefined>(undefined);
  myGroups = signal<Group[]>([]);
  myRequests = signal<AppRequest[]>([]);

  editing = signal(false);
  formError = signal('');
  formSuccess = signal('');
  saving = signal(false);

  uploadingAvatar = signal(false);
  avatarError = signal('');

  // the server's limits, checked first to avoid a pointless upload. the server still checks.
  private readonly imageTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  private readonly maxImageBytes = 5 * 1024 * 1024;

  // form fields. plain, [(ngModel)] writes them from DOM events
  formUsername = '';
  formDob = '';
  formBio = '';
  formPassword = '';       // blank = unchanged, not sent

  // your own pending and rejected requests, from one list
  pendingRequests = computed(() => this.myRequests().filter(r => r.status === 'pending'));
  rejectedRequests = computed(() => this.myRequests().filter(r => r.status === 'rejected'));

  // groups you admin (stored on the groups, not the user)
  adminOf = computed(() => this.myGroups().filter(g => g.adminEmails.includes(this.email)));

  // worked out from the date of birth, same as server.js
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

    // live: a request raised or actioned anywhere (e.g. mine approved) refreshes this page. stops
    // listening when the page goes.
    const stop = inject(ChatService).onRequestsChanged(() => this.load());
    inject(DestroyRef).onDestroy(stop);
  }

  private load() {
    if (!this.email) {
      return;
    }

    // from the server, localStorage only has a few fields and goes stale
    this.auth.fetchUser(this.email).subscribe(user => this.user.set(user));

    this.groupService.getGroups().subscribe(groups => {
      this.myGroups.set(groups.filter(g => g.memberEmails.includes(this.email)));
    });

    this.requestService.getRequests({ requestedBy: this.email }).subscribe(requests => {
      this.myRequests.set(requests);
    });
  }

  // the picture's address, or '' to show the initial
  avatarSrc = computed(() => {
    const url = this.user()?.avatarUrl;
    return url ? this.auth.avatarSrc(url) : '';
  });

  // uploads as soon as a file is picked, no save step
  onAvatarChosen(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';      // so picking the same file again still fires (change)
    if (!file) {
      return;
    }

    this.avatarError.set('');
    if (!this.imageTypes.includes(file.type)) {
      this.avatarError.set('Choose a PNG, JPEG, GIF or WebP image.');
      return;
    }
    if (file.size > this.maxImageBytes) {
      this.avatarError.set('Images must be 5 MB or smaller.');
      return;
    }

    this.uploadingAvatar.set(true);
    this.auth.uploadAvatar(file).subscribe({
      next: updated => this.afterAvatarChange(updated),
      error: (err: HttpErrorResponse) => {
        this.avatarError.set(err.error?.error ?? 'Could not upload that image.');
        this.uploadingAvatar.set(false);
      },
    });
  }

  onRemoveAvatar() {
    this.avatarError.set('');
    this.auth.removeAvatar().subscribe({
      next: updated => this.afterAvatarChange(updated),
      error: (err: HttpErrorResponse) => this.avatarError.set(err.error?.error ?? 'Could not remove the picture.'),
    });
  }

  // show the updated account and refresh the session so the navbar updates too
  private afterAvatarChange(updated: AppUser) {
    this.user.set(updated);
    this.saveSession(updated);
    this.uploadingAvatar.set(false);
  }

  // the navbar reads name and picture from localStorage, so keep it current
  private saveSession(user: AppUser) {
    this.auth.saveUser({ email: user.email, role: user.role, username: user.username, avatarUrl: user.avatarUrl });
  }

  startEditing() {
    // open the form with the saved values
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
    this.formError.set('');
    this.formSuccess.set('');

    // checked here first, the server checks the same again. a blank password means "keep it"
    const problem = firstProblem(
      nameProblem('Display name', this.formUsername),
      dobProblem(this.formDob),
      textProblem('Bio', this.formBio),
      passwordProblem(this.formPassword, false));
    if (problem) {
      this.formError.set(problem);
      return;
    }
    this.saving.set(true);

    // no email (the identifier) and no role (or you could promote yourself)
    const changes: ProfileChanges = {
      username: this.formUsername,
      dob: this.formDob,
      bio: this.formBio,
    };

    // only sent if typed, so the password isn't blanked
    if (this.formPassword) {
      changes.password = this.formPassword;
    }

    this.auth.updateProfile(this.email, changes).subscribe({
      next: updated => {
        this.user.set(updated);
        this.saveSession(updated);
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

  // readable label for a request type
  labelFor(type: string) {
    const labels: Record<string, string> = {
      'group-create': 'New group',
      'group-delete': 'Delete group',
      'channel-create': 'New room',
      'group-join': 'Join group',
      'user-ban': 'Ban user',
    };
    return labels[type] ?? type;
  }
}
