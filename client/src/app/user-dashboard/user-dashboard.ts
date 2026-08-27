import { Component, inject, signal } from '@angular/core';   // signal = angular's reactive value holder
import { FormsModule } from '@angular/forms';                // lets the html use [(ngModel)] on the create form
import { RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';    // the type of error http requests give back
import { Navbar } from '../navbar/navbar'
import { Auth } from '../auth';
import { GroupService, Group } from '../group';

@Component({
  selector: 'app-user-dashboard',
  imports: [Navbar, RouterLink, FormsModule],
  templateUrl: './user-dashboard.html',
  styleUrl: './user-dashboard.css',
})
export class UserDashboard {
  private groupService = inject(GroupService);
  private auth = inject(Auth);

  private me = this.auth.getUser()?.email ?? '';   // whoever is logged in, used to split the two lists
  isSuper = this.auth.getUser()?.role === 'super';   // the super admin can't be a member of any group (see server.js), so the member-split below doesn't apply to them

  // these are signals, not plain arrays. this app is zoneless (there's no zone.js), so angular only
  // rerenders when a signal changes. setting a normal property inside a subscribe would update the
  // value but leave the screen showing the old empty list until something else triggered a redraw.
  myGroups = signal<Group[]>([]);     // groups this user is already a member of
  discover = signal<Group[]>([]);     // everything else, the groups they could join

  // a signal rather than a plain boolean because onCreateGroup closes the form from inside a
  // subscribe callback, which is exactly the async case that needs one.
  showForm = signal(false);

  // the create group fields. plain properties, because [(ngModel)] writes to them from a DOM
  // event and angular already schedules a redraw after those.
  newName = '';
  newDescription = '';
  newAgeLimit = 0;
  newTheme = '#5FA8D3';       // the same default the server falls back to

  // one pair of messages shared by the create form and the join buttons, so feedback always
  // turns up in the same place. signals, because both are set inside subscribe callbacks.
  formError = signal('');
  formSuccess = signal('');

  constructor() {
    this.loadGroups();
  }

  // pulled out of the constructor so it can be called again after creating or joining a group,
  // which is what makes the new group appear without a page refresh
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
  }

  toggleForm() {
    this.showForm.update(open => !open);   // update() reads the current value and writes the new one
    this.formError.set('');                // don't leave a message from a previous attempt hanging around
    this.formSuccess.set('');
  }

  onCreateGroup() {           // runs when the create group form is submitted
    this.formError.set('');
    this.formSuccess.set('');

    this.groupService
      .createGroup(this.newName, this.newDescription, Number(this.newAgeLimit), this.newTheme, this.me)
      .subscribe({
        next: created => {
          // the server made the creator this group's first admin, so it lands in My Groups and
          // the navbar's Group Admin link starts showing on that group's pages
          this.formSuccess.set(`Group "${created.name}" created. You are its first admin.`);
          this.newName = '';
          this.newDescription = '';
          this.newAgeLimit = 0;
          this.newTheme = '#5FA8D3';
          this.showForm.set(false);
          this.loadGroups();
        },
        error: (err: HttpErrorResponse) => {
          // express sends its errors as { error: '...' }, and that body lands on err.error
          this.formError.set(err.error?.error ?? 'Something went wrong, please try again.');
        },
      });
  }

  onJoin(group: Group) {      // runs when a Join button in Discover is clicked
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
}
