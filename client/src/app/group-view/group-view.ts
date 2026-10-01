import { Component, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';   // ActivatedRoute = the current url's details
import { HttpErrorResponse } from '@angular/common/http';
import { Navbar } from '../navbar/navbar';
import { Auth } from '../auth';
import { GroupService, Group, Channel } from '../group';
import { RequestService, AppRequest } from '../request';
import { readableInk, LIGHT_INK } from '../theme';

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

  proposedName = '';      // plain, [(ngModel)] writes it from a DOM event
  formError = signal('');
  formSuccess = signal('');
  joining = signal(false);     // stops a double join

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
  }

  private loadGroup() {
    this.groupService.getGroups().subscribe(groups => {
      this.groups.set(groups);
      this.group.set(groups.find(g => g._id === this.groupId));
    });

    this.groupService.getChannels(this.groupId).subscribe(channels => {
      this.channels.set(channels);
    });

    // so members can see their proposal is waiting
    this.requestService.getRequests({ groupId: this.groupId, status: 'pending', scope: 'group' })
      .subscribe(requests => this.proposals.set(requests));
  }

  // join from the group page. the server checks age limit and bans.
  onJoin() {
    const group = this.group();
    if (!group || this.joining()) {
      return;
    }
    this.joining.set(true);
    this.formError.set('');
    this.formSuccess.set('');

    this.groupService.joinGroup(group._id, this.me).subscribe({
      next: () => {
        this.formSuccess.set(`Joined ${group.name}. You can chat in its rooms now.`);
        this.joining.set(false);
        this.loadGroup();       // rooms become links
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
