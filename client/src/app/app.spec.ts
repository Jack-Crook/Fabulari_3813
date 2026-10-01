import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { testProviders } from './testing';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: testProviders(),
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render a router-outlet', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    // the root is just the outlet, each page brings its own navbar
    expect(compiled.querySelector('router-outlet')).toBeTruthy();
  });
});


// need at least 1 test for each route
// endpoints can use either
// have components with lots of tests