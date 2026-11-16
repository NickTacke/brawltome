//! runs what the session decides: lookups, timers, the overlay, links and the published status

use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use brawltome_detection::Event;
use tokio::sync::{mpsc, watch};
use tokio::task::{JoinError, JoinSet};
use tokio::time::Instant;

use crate::app_status::AppStatus;
use crate::lobby_client::{LobbyLookup, LobbyRequest};
use crate::overlay_view::OverlayView;
use crate::session::{Effect, Input, Session, Timer};

pub trait OverlaySurface: Send + Sync + 'static {
    fn show(&self, view: &OverlayView);
    fn hide(&self);
}

pub trait LinkOpener: Send + Sync + 'static {
    fn open(&self, url: &str);
}

/// what the rest of the app holds to talk to the running session
#[derive(Clone)]
pub struct SessionHandle {
    inputs: mpsc::UnboundedSender<Input>,
    status: watch::Receiver<AppStatus>,
    overlay_view: watch::Receiver<Option<OverlayView>>,
}

impl SessionHandle {
    pub fn send(&self, input: Input) {
        if self.inputs.send(input).is_err() {
            log::debug!("session input dropped: the session has stopped");
        }
    }

    pub fn status(&self) -> watch::Receiver<AppStatus> {
        self.status.clone()
    }

    pub fn overlay_view(&self) -> Option<OverlayView> {
        self.overlay_view.borrow().clone()
    }
}

/// owns the session; returns when `events` closes
pub fn spawn<L: LobbyLookup>(
    events: mpsc::Receiver<Event>,
    lookup: Arc<L>,
    surface: Arc<dyn OverlaySurface>,
    links: Arc<dyn LinkOpener>,
) -> SessionHandle {
    let (input_sender, inputs) = mpsc::unbounded_channel();
    let (status_sender, status) = watch::channel(AppStatus::default());
    let (overlay_view_sender, overlay_view) = watch::channel(None);

    let runner = Runner {
        session: Session::new(),
        clock: SessionClock::start(),
        lookup,
        surface,
        links,
        lobby_work: JoinSet::new(),
        status: status_sender,
        overlay_view: overlay_view_sender,
    };
    tokio::spawn(runner.run(events, inputs));

    SessionHandle {
        inputs: input_sender,
        status,
        overlay_view,
    }
}

/// the session's clock never goes backwards; the wall clock is only for what people read
struct SessionClock {
    started: Instant,
}

impl SessionClock {
    fn start() -> Self {
        Self {
            started: Instant::now(),
        }
    }

    fn now_ms(&self) -> u64 {
        u64::try_from(self.started.elapsed().as_millis()).unwrap_or(u64::MAX)
    }

    /// dated back from now by how long ago it was, so a clock change or a sleep doesn't shift it
    fn to_epoch_ms(&self, session_ms: u64) -> u64 {
        let since_epoch = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default();
        let now_epoch_ms = u64::try_from(since_epoch.as_millis()).unwrap_or(u64::MAX);
        let age_ms = self.now_ms().saturating_sub(session_ms);

        now_epoch_ms.saturating_sub(age_ms)
    }
}

struct Runner<L> {
    session: Session,
    clock: SessionClock,
    lookup: Arc<L>,
    surface: Arc<dyn OverlaySurface>,
    links: Arc<dyn LinkOpener>,
    /// lookups and timers of the lobby on screen; each one ends in the input it feeds back
    lobby_work: JoinSet<Input>,
    status: watch::Sender<AppStatus>,
    overlay_view: watch::Sender<Option<OverlayView>>,
}

impl<L: LobbyLookup> Runner<L> {
    async fn run(
        mut self,
        mut events: mpsc::Receiver<Event>,
        mut inputs: mpsc::UnboundedReceiver<Input>,
    ) {
        loop {
            let input = tokio::select! {
                event = events.recv() => match event {
                    Some(event) => Input::Detection(event),
                    None => break,
                },
                Some(input) = inputs.recv() => input,
                Some(finished) = self.lobby_work.join_next(), if !self.lobby_work.is_empty() => {
                    match fed_back_input(finished) {
                        Some(input) => input,
                        None => continue,
                    }
                }
            };

            let effects = self.session.handle(input, self.clock.now_ms());
            for effect in effects {
                self.run_effect(effect);
            }
        }

        log::info!("detection stopped, so the session stops too");
    }

    fn run_effect(&mut self, effect: Effect) {
        match effect {
            // dropping the old set aborts its tasks and discards what they already returned
            Effect::DropLobbyWork => self.lobby_work = JoinSet::new(),
            Effect::LookUp { lobby_id, request } => self.look_up(lobby_id, request),
            Effect::StartTimer {
                lobby_id,
                timer,
                after_ms,
            } => self.start_timer(lobby_id, timer, after_ms),
            Effect::ShowCards(view) => {
                self.surface.show(&view);
                self.overlay_view.send_replace(Some(view));
            }
            Effect::HideCards => {
                self.surface.hide();
                self.overlay_view.send_replace(None);
            }
            Effect::OpenLinks(urls) => {
                for url in urls {
                    self.links.open(&url);
                }
            }
            Effect::StatusChanged(status) => self.publish_status(status),
        }
    }

    fn look_up(&mut self, lobby_id: u64, request: LobbyRequest) {
        let lookup = Arc::clone(&self.lookup);

        self.lobby_work.spawn(async move {
            let result = lookup.look_up(request).await;

            Input::LookupFinished { lobby_id, result }
        });
    }

    fn start_timer(&mut self, lobby_id: u64, timer: Timer, after_ms: u64) {
        self.lobby_work.spawn(async move {
            tokio::time::sleep(Duration::from_millis(after_ms)).await;

            Input::TimerFired { lobby_id, timer }
        });
    }

    /// the session counts from its start; the main window shows times of day
    fn publish_status(&self, mut status: AppStatus) {
        for recent_match in &mut status.recent_matches {
            recent_match.started_at_ms = self.clock.to_epoch_ms(recent_match.started_at_ms);
        }

        self.status.send_replace(status);
    }
}

/// none for work that was aborted with its lobby
fn fed_back_input(finished: Result<Input, JoinError>) -> Option<Input> {
    let error = match finished {
        Ok(input) => return Some(input),
        Err(error) => error,
    };

    if error.is_panic() {
        log::error!("a lookup or timer of the lobby on screen panicked: {error}");
    }

    None
}
