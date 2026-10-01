import { Component, inject, signal, computed, DestroyRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';   // ActivatedRoute = the current url's details
import { HttpErrorResponse } from '@angular/common/http';
import { Navbar } from '../navbar/navbar';
import { Auth } from '../auth';
import { GroupService, Group, Channel } from '../group';
import { RequestService, AppRequest } from '../request';
import { ChatService } from '../chat';
import { readableInk, LIGHT_INK } from '../theme';
import { nameProblem } from '../validation';

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

  // signals, since they're set in subscribe and the app is zoneless
  groups = signal<Group[]>([]);            // for the sidebar
  group = signal<Group | undefined>(undefined);   // the one in the url
  channels = signal<Channel[]>([]);
  proposals = signal<AppRequest[]>([]);    // pending room proposals
  myJoinRequest = signal<AppRequest | undefined>(undefined);   // my request to join, if it's waiting

  proposedName = '';      // plain, [(ngModel)] writes it from a DOM event
  formError = signal('');
  formSuccess = signal('');
  joining = signal(false);     // stops a double click sending two requests

  // group admin is stored on the group, not the user
  isGroupAdmin = computed(() => this.group()?.adminEmails.includes(this.me) ?? false);

  isMember = computed(() => this.group()?.memberEmails.includes(this.me) ?? false);

  // readable banner text for whatever theme the admin picked (theme.ts)
  ink = computed(() => readableInk(this.group()?.theme ?? ''));

  // flips the pills' overlay to match the text
  onDark = computed(() => this.ink() === LIGHT_INK);

  // per sidebar tile, each has its own colour
  inkFor(theme: string) {
    return readableInk(theme);
  }

  constructor() {
    // subscribed, because switching groups in the sidebar reuses this component
    this.route.paramMap.subscribe(params => {
      this.groupId = params.get('id') ?? '';
      this.loadGroup();
    });

    // live: a request about this group raised or actioned (e.g. my request to join approved)
    // refreshes the page. stops listening when the page goes.
    const stop = inject(ChatService).onRequestsChanged(groupId => {
      if (groupId === this.groupId) {
        this.loadGroup();
      }
    });
    inject(DestroyRef).onDestroy(stop);
  }

  private loadGroup() {
    this.groupService.getGroups().subscribe(groups => {
      this.groups.set(groups);
      this.group.set(groups.find(g => g._id === this.groupId));
    });

    this.groupService.getChannels(this.groupId).subscribe(channels => {
      this.channels.set(channels);
    });

    // so members can see their proposal is waiting. room proposals only, join requests are private
    this.requestService.getRequests({ groupId: this.groupId, status: 'pending', type: 'channel-create' })
      .subscribe(requests => this.proposals.set(requests));

    // whether I've already asked to join, so the page says so instead of offering the button again
    this.requestService.getRequests({ groupId: this.groupId, status: 'pending', type: 'group-join', requestedBy: this.me })
      .subscribe(requests => this.myJoinRequest.set(requests[0]));
  }

  // ask to join from the group page. an admin approves it, or it's rejected straight away with the
  // reason if I'm too young or have no date of birth set.
  onJoin() {
    const group = this.group();
    if (!group || this.joining()) {
      return;
    }
    this.joining.set(true);
    this.formError.set('');
    this.formSuccess.set('');

    this.requestService.raise('group-join', this.me, {}, group._id).subscribe({
      next: request => {
        if (request.status === 'rejected') {
          this.formError.set(request.reason);
        } else {
          this.formSuccess.set(`Asked to join ${group.name}. An admin of the group will review it.`);
        }
        this.joining.set(false);
        this.loadGroup();
      },
      error: (err: HttpErrorResponse) => {
        this.formError.set(err.error?.error ?? 'Something went wrong, please try again.');
        this.joining.set(false);
      },
    });
  }

  // members propose rooms, a group admin approves them
  onPropose() {
    this.formError.set('');
    this.formSuccess.set('');

    const problem = nameProblem('Room name', this.proposedName);
    if (problem) {
      this.formError.set(problem);
      return;
    }

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
