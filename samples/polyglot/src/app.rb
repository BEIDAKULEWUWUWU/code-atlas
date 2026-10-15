# frozen_string_literal: true

require 'json'
require 'set'

module Polyglot
  class Index
    attr_reader :documents

    def initialize
      @documents = {}
      @stopwords = Set.new(%w[the a an of and or])
    end

    def add(id, text)
      @documents[id] = text.downcase.split(/\W+/).reject { |w| @stopwords.include?(w) }
      self
    end

    def search(term)
      @documents.select { |_, words| words.include?(term.downcase) }.keys
    end

    def to_json(*)
      { size: @documents.size, ids: @documents.keys }.to_json
    end
  end
end
