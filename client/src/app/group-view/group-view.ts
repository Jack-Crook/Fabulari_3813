import { Component, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';                    // lets the html use [(ngModel)] on the propose form
import { ActivatedRoute, RouterLink } from '@angular/router';   // ActivatedRoute = details about the url that opened this component
import { HttpErrorResponse } from '@angular/common/http';
import { Navbar } from '../navbar/navbar';
import { Auth } from '../auth';
import { GroupService, Group, Channel } from '../group';
import { RequestService, AppRequest } from '../request';

@Component({
  selector: 'app-group-view',
  imports: [Navbar, RouterLink, FormsModule],
  templateUrl: './group-view.html',
  styleUrl: './group-view.css',
})
export class GroupView {
  private groupService = inject(GroupService);
  private requestService = inject(RequestService);
  private route = inject(ActivatedRoute);
  private auth = inject(Auth);

  private groupId = '';
  me = this.auth.email;
  isSuper = this.auth.isSuper;

  // signals, because this app is zoneless. angular only knows to redraw when a signal changes,
  // so setting a plain property inside a subscribe would leave the page showing nothing.
  groups = signal<Group[]>([]);            // every group, used for the sidebar down the left
  group = signal<Group | undefined>(undefined);   // just the one whose id is in the url, shown in the banner
  channels = signal<Channel[]>([]);        // the rooms inside that group
  proposals = signal<AppRequest[]>([]);    // rooms proposed for this group and not yet actioned

  // the propose-a-room form. a plain property, because [(ngModel)] writes it from a DOM event
  proposedName = '';
  formError = signal('');
  formSuccess = signal('');

  // group admin is a relationship with this group rather than a role on the account, so it's
  // read out of the group's adminEmails. a computed, because the group arrives asynchronously.
  isGroupAdmin = computed(() => this.group()?.adminEmails.includes(this.me) ?? false);

  // the super admin oversees every group without being a member of any, so the propose form
  // is for actual members only
  isMember = computed(() => this.group()?.memberEmails.includes(this.me) ?? false);

  constructor() {
    // paramMap is subscribed to rather than read once, because clicking a different group in
    // the sidebar reuses this same component and only changes the :id. a one off read wouldn't rerun.
    this.route.paramMap.subscribe(params => {
      this.groupId = params.get('id') ?? '';
      this.loadGroup();
    });
  }

  private loadGroup() {
    this.groupService.getGroups().subscribe(groups => {   // fill the sidebar, and pick out the one being viewed
      this.groups.set(groups);
      this.group.set(groups.find(g => g.id === this.groupId));
    });

    this.groupService.getChannels(this.groupId).subscribe(channels => {
      this.channels.set(channels);
    });

    // so a member can see the room they proposed is still waiting, rather than it vanishing
    // until an admin gets to it
    this.requestService.getRequests({ groupId: this.groupId, status: 'pending', scope: 'group' })
      .subscribe(requests => this.proposals.set(requests));
  }

  // the spec says regular users propose a room and the group admin approves or rejects it.
  // an admin doesn't need this — they create rooms outright from the admin dashboard.
  onPropose() {
    this.formError.set('');
    this.formSuccess.set('');

    this.requestService.raise('channel-create', this.me, { name: this.proposedName }, this.groupId).subscribe({
      next: () => {
        this.formSuccess.set(`Proposed "${this.proposedName}". An admin of this group will review it.`);
        this.proposedName = '';
        this.loadGroup();
      },
      error: (err: HttpErrorResponse) => {
        this.formError.set(err.error?.error ?? 'Something went wrong, please try again.');
      },
    });
  }
}
