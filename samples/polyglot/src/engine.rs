use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct Rule {
    pub name: String,
    pub weight: f64,
}

pub struct Engine {
    rules: HashMap<String, Rule>,
    threshold: f64,
}

impl Engine {
    pub fn new(threshold: f64) -> Self {
        Self { rules: HashMap::new(), threshold }
    }

    pub fn insert(&mut self, rule: Rule) -> Option<Rule> {
        self.rules.insert(rule.name.clone(), rule)
    }

    pub fn evaluate(&self, key: &str) -> Option<&Rule> {
        self.rules.get(key).filter(|r| r.weight >= self.threshold)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn threshold_filters() {
        let mut engine = Engine::new(0.5);
        engine.insert(Rule { name: "a".into(), weight: 0.9 });
        assert!(engine.evaluate("a").is_some());
    }
}
